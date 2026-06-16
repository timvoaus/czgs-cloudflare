/**
 * Browser-Side Sync Engine for CZGS
 * Downloads, processes, de-duplicates list domains, and syncs them to Cloudflare Gateway via Worker APIs.
 */

// Simple Domain Validation helpers (matching backend)
const isValidDomain = (value) =>
  /^\b((?=[a-z0-9-]{1,63}\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,63}\b$/.test(
    value
  );

const isComment = (value) =>
  value.startsWith("#") ||
  value.startsWith("//") ||
  value.startsWith("!") ||
  value.startsWith("/*") ||
  value.startsWith("*/");

const normalizeDomain = (value, isAllowlisting) => {
  const init = isAllowlisting ? value.replace("@@||", "") : value;
  return init
    .replace(/(0\.0\.0\.0|127\.0\.0\.1|::1|::)\s+/, "")
    .replace("||", "")
    .replace("^$important", "")
    .replace("*.", "")
    .replace("^", "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
};

// Sleep helper
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Download blocklists / allowlists via Worker CORS proxy, parse and normalize domains
 */
export async function downloadAndProcessLists(urls, isAllowlist, log, onProgress) {
  const allDomains = new Set();
  let completed = 0;

  log(`Downloading ${urls.length} list(s)...`);

  for (const url of urls) {
    if (!url) continue;
    log(`Downloading: ${url}`);
    try {
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      const lines = text.split(/\r?\n/);
      let count = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isComment(trimmed)) continue;

        const domain = normalizeDomain(trimmed, isAllowlist);
        if (isValidDomain(domain)) {
          allDomains.add(domain);
          count++;
        }
      }

      completed++;
      log(`Downloaded list ${completed}/${urls.length}: Found ${count} valid domains`);
    } catch (err) {
      log(`Error downloading list (${url}): ${err.message}`);
      completed++;
    }
    if (onProgress) {
      onProgress(completed, urls.length);
    }
  }

  log(`Merged and de-duplicated: ${allDomains.size} unique domains found.`);
  return [...allDomains];
}

/**
 * Check existing lists and sync additions/removals
 */
export async function syncGatewayLists(domains, listLimit, patchSize, log, onProgress) {
  log("Fetching existing Gateway lists from Cloudflare...");
  const listsRes = await fetch("/api/gateway/lists").then(r => r.json());
  const lists = listsRes.result || [];
  const czgsLists = lists.filter(l => l.name.startsWith("CZGS List - Chunk ")) || [];
  log(`Found ${czgsLists.length} existing CZGS list(s).`);

  // Sort lists by chunk number
  czgsLists.sort((a, b) => {
    const aNum = parseInt(a.name.replace("CZGS List - Chunk ", ""));
    const bNum = parseInt(b.name.replace("CZGS List - Chunk ", ""));
    return aNum - bNum;
  });

  const domainsByList = {};
  log("Downloading current list items from Cloudflare Gateway...");
  let fetchedCount = 0;
  for (const list of czgsLists) {
    log(`Fetching items for list: ${list.name}`);
    const itemsRes = await fetch(`/api/gateway/lists/${list.id}/items`).then(r => r.json());
    domainsByList[list.id] = (itemsRes.result || []).map(item => item.value);
    fetchedCount++;
    if (onProgress) {
      onProgress('fetch', fetchedCount, czgsLists.length);
    }
  }
  log(`Fetched current items from ${fetchedCount} list(s).`);

  const existingDomains = {};
  for (const [listId, listDomains] of Object.entries(domainsByList)) {
    for (const d of listDomains) {
      existingDomains[d] = listId;
    }
  }

  const itemSet = new Set(domains);
  const toRemove = {};
  for (const [domain, listId] of Object.entries(existingDomains)) {
    if (!itemSet.has(domain)) {
      toRemove[domain] = listId;
    }
  }

  const toAdd = domains.filter(domain => !existingDomains[domain]);
  log(`Sync Diff: ${Object.keys(toRemove).length} domains to remove, ${toAdd.length} domains to add.`);

  // Group removals by list
  const removalPatches = {};
  for (const [domain, listId] of Object.entries(toRemove)) {
    removalPatches[listId] = removalPatches[listId] || { remove: [] };
    removalPatches[listId].remove.push(domain);
  }

  const patches = {};
  const NOW_STR = new Date().toISOString();

  // Fill in any removal spaces with additions
  for (const [listId, patch] of Object.entries(removalPatches)) {
    const spaceInList = 1000 - (domainsByList[listId].length - patch.remove.length);
    const append = [];
    for (let s = 0; s < spaceInList; s++) {
      if (toAdd.length === 0) break;
      append.push({ value: toAdd.shift(), description: NOW_STR });
    }
    patches[listId] = { ...patch, append };
  }

  // If there are still additions left, fill up remaining space in lists not patched
  if (toAdd.length > 0) {
    const unpatchedListIds = Object.keys(domainsByList).filter(listId => !patches[listId]);
    for (const listId of unpatchedListIds) {
      const spaceInList = 1000 - domainsByList[listId].length;
      if (spaceInList > 0) {
        const append = [];
        for (let s = 0; s < spaceInList; s++) {
          if (toAdd.length === 0) break;
          append.push({ value: toAdd.shift(), description: NOW_STR });
        }
        if (append.length > 0) {
          patches[listId] = { append };
        }
      }
    }
  }

  // Patch existing lists
  const patchEntries = Object.entries(patches);
  if (patchEntries.length > 0) {
    log(`Syncing ${patchEntries.length} list patches...`);
    let completedPatches = 0;
    for (const [listId, patch] of patchEntries) {
      const listName = czgsLists.find(l => l.id === listId)?.name || listId;
      const adds = patch.append ? patch.append.length : 0;
      const removes = patch.remove ? patch.remove.length : 0;
      log(`Patching ${listName}: Adding ${adds}, Removing ${removes}...`);

      const patchRes = await fetch("/api/gateway/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId, patch, listName }),
      }).then(r => r.json());

      if (!patchRes.success) {
        throw new Error(`Failed to patch list ${listName}`);
      }
      completedPatches++;
      if (onProgress) {
        onProgress('patch', completedPatches, patchEntries.length);
      }
    }
    log(`List patching complete (${completedPatches}/${patchEntries.length} lists patched).`);
  }

  // Create new lists if additions still remain
  if (toAdd.length > 0) {
    let nextListNumber = Math.max(0, ...czgsLists.map(l => parseInt(l.name.replace("CZGS List - Chunk ", ""))).filter(x => Number.isInteger(x))) + 1;
    const totalNewLists = Math.ceil(toAdd.length / 1000);
    log(`Creating ${totalNewLists} new list(s) for remaining domains...`);
    let createdCount = 0;

    while (toAdd.length > 0) {
      const listName = `CZGS List - Chunk ${nextListNumber}`;
      const chunk = toAdd.slice(0, 1000).map(d => ({ value: d, description: NOW_STR }));
      toAdd.splice(0, 1000);

      log(`Creating list "${listName}"...`);
      const createRes = await fetch("/api/gateway/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: listName, type: "DOMAIN", items: chunk }),
      }).then(r => r.json());

      if (!createRes.success) {
        throw new Error(`Failed to create list "${listName}": ${createRes.errors?.[0]?.message || 'Unknown error'}`);
      }
      nextListNumber++;
      createdCount++;
      if (onProgress) {
        onProgress('create', createdCount, totalNewLists);
      }
    }
    log("New lists created successfully.");
  }

  log("List synchronization complete!");
}



/**
 * Upsert Gateway rule to point to all CZGS lists
 */
export async function upsertGatewayRule(ruleName, isSniRule, log, customLists = null) {
  log("Updating Firewall DNS Rule...");
  let czgsLists;
  if (customLists) {
    czgsLists = customLists;
  } else {
    const listsRes = await fetch("/api/gateway/lists").then(r => r.json());
    const lists = listsRes.result || [];
    czgsLists = lists.filter(l => l.name.startsWith("CZGS List"));
  }

  if (czgsLists.length === 0) {
    log("No CZGS lists found. Skipping rule creation.");
    return;
  }

  const field = isSniRule ? "net.sni.domains[*]" : "dns.domains[*]";
  const filterType = isSniRule ? ["l4"] : ["dns"];
  const wirefilterExpression = czgsLists
    .map(list => `any(${field} in \$${list.id})`)
    .join(" or ");

  const rulesRes = await fetch("/api/gateway/rules").then(r => r.json());
  const rules = rulesRes.result || [];
  const existingRule = rules.find(r => r.name === ruleName);

  const payload = {
    name: ruleName,
    description: "Filter lists created by Cloudflare Gateway Dashboard. Avoid editing this rule.",
    enabled: true,
    action: "block",
    rule_settings: {
      block_page_enabled: false,
      block_reason: "Blocked by CZGS Gateway filter lists."
    },
    filters: filterType,
    traffic: wirefilterExpression,
  };

  if (existingRule) {
    log(`Updating existing rule: ${ruleName}`);
    const updateRes = await fetch(`/api/gateway/rules/${existingRule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!updateRes.success) throw new Error("Failed to update rule.");
    log("Rule updated successfully.");
  } else {
    log(`Creating new rule: ${ruleName}`);
    const createRes = await fetch("/api/gateway/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!createRes.success) throw new Error("Failed to create rule.");
    log("Rule created successfully.");
  }
}

/**
 * Defragment Lists
 */
export async function defragmentLists(log, onProgress) {
  const emitProgress = (phase, current, total, message) => {
    onProgress?.(phase, current, total, message);
  };

  log("Starting defragmentation...");
  log("Defragmenting empty lists and consolidating stable domains is fully automated!");
  log("Fetching lists...");
  
  emitProgress("fetch", 0, 1, "Fetching lists...");
  const listsRes = await fetch("/api/gateway/lists").then(r => r.json());
  const lists = listsRes.result || [];
  const czgsLists = lists.filter(l => l.name.startsWith("CZGS List - Chunk "));

  if (czgsLists.length <= 1) {
    log("Only 1 list or fewer found. Defragmentation not required.");
    emitProgress("complete", 1, 1, "Defragmentation not required.");
    return;
  }

  // Sort lists by chunk number to ensure chronological ordering
  czgsLists.sort((a, b) => {
    const aNum = parseInt(a.name.replace("CZGS List - Chunk ", ""));
    const bNum = parseInt(b.name.replace("CZGS List - Chunk ", ""));
    return aNum - bNum;
  });

  const allEntries = [];
  log(`Downloading domains from ${czgsLists.length} list(s)...`);
  let fetchedCount = 0;
  for (const list of czgsLists) {
    emitProgress("fetch", fetchedCount, czgsLists.length, `Downloading ${list.name}...`);
    const itemsRes = await fetch(`/api/gateway/lists/${list.id}/items`).then(r => r.json());
    const items = itemsRes.result || [];
    for (const item of items) {
      allEntries.push({
        value: item.value,
        description: item.description || new Date().toISOString(),
        originListId: list.id
      });
    }
    fetchedCount++;
  }
  emitProgress("fetch", fetchedCount, czgsLists.length, "All lists downloaded.");

  log(`Fetched ${allEntries.length} domains total. Rearranging entries by age...`);
  // Sort entries: older (stable) domains first. Ensure invalid dates don't break sorting.
  allEntries.sort((a, b) => {
    const timeA = isNaN(new Date(a.description).getTime()) ? new Date().getTime() : new Date(a.description).getTime();
    const timeB = isNaN(new Date(b.description).getTime()) ? new Date().getTime() : new Date(b.description).getTime();
    if (timeA === timeB) return a.value.localeCompare(b.value);
    return timeA - timeB;
  });

  // Assign domains back to chunks (max 1000 per list)
  const assigned = allEntries.map((entry, index) => {
    const listIndex = Math.floor(index / 1000);
    const assignedListId = czgsLists[listIndex]?.id;
    return { ...entry, assignedListId };
  });

  const moves = assigned.filter(entry => entry.originListId !== entry.assignedListId);
  log(`Calculated ${moves.length} domain relocations needed.`);

  const patches = {};
  for (const entry of moves) {
    const { originListId, assignedListId, value, description } = entry;
    if (assignedListId) {
      // Removals
      patches[originListId] = patches[originListId] || { remove: [], append: [] };
      patches[originListId].remove.push(value);
      // Appends
      patches[assignedListId] = patches[assignedListId] || { remove: [], append: [] };
      patches[assignedListId].append.push({ value, description });
    }
  }

  const patchEntries = Object.entries(patches);
  if (patchEntries.length > 0) {
    log(`Applying defragmentation patches to ${patchEntries.length} lists...`);
    let patchCount = 0;
    for (const [listId, patch] of patchEntries) {
      const listName = czgsLists.find(l => l.id === listId)?.name || listId;
      emitProgress("defrag", patchCount, patchEntries.length, `Patching list: ${listName}...`);
      
      const patchRes = await fetch("/api/gateway/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId, patch, listName })
      }).then(r => r.json());

      if (!patchRes.success) {
        throw new Error(`Failed to patch list ${listName}`);
      }
      patchCount++;
    }
    emitProgress("defrag", patchCount, patchEntries.length, "Defragmentation patches applied.");
  } else {
    log("All domains are already in optimal positions.");
  }

  // Identify empty and non-empty lists
  const assignedListIds = new Set(assigned.map(e => e.assignedListId).filter(Boolean));
  const emptyLists = czgsLists.filter(l => !assignedListIds.has(l.id));
  const nonEmptyLists = czgsLists.filter(l => assignedListIds.has(l.id));

  // Update Firewall rules FIRST to reference only non-empty lists (removing empty lists from rule expressions)
  log("Updating Gateway rules to reference non-empty lists...");
  const rulesRes = await fetch("/api/gateway/rules").then(r => r.json());
  const rules = rulesRes.result || [];
  const hasDnsRule = rules.some(r => r.name === "CZGS Filter Lists");
  const hasSniRule = rules.some(r => r.name === "CZGS Filter Lists - SNI Based Filtering");

  if (hasDnsRule) {
    await upsertGatewayRule("CZGS Filter Lists", false, log, nonEmptyLists);
  }
  if (hasSniRule) {
    await upsertGatewayRule("CZGS Filter Lists - SNI Based Filtering", true, log, nonEmptyLists);
  }

  // Now that the empty lists are no longer referenced in the firewall rules, we can safely delete them
  if (emptyLists.length > 0) {
    log(`Deleting ${emptyLists.length} empty list(s)...`);
    let deleteCount = 0;
    for (const list of emptyLists) {
      emitProgress("defrag", deleteCount, emptyLists.length, `Deleting empty list: ${list.name}...`);
      const delRes = await fetch(`/api/gateway/lists/${list.id}`, { method: "DELETE" }).then(r => r.json());
      if (!delRes.success) {
        log(`Warning: Failed to delete list ${list.name}`);
      }
      deleteCount++;
    }
    emitProgress("defrag", deleteCount, emptyLists.length, "Empty lists deleted.");
  }

  emitProgress("complete", 1, 1, "Defragmentation complete!");
  log("Defragmentation complete!");
}

/**
 * Full Reset (Deletes all CZGS resources)
 */
export async function fullReset(log, onProgress) {
  const emitProgress = (phase, current, total, message) => {
    onProgress?.(phase, current, total, message);
  };

  log("Starting full reset of CZGS resources...");
  log("Fetching rules...");
  emitProgress("reset", 0, 1, "Fetching rules...");
  
  const rulesRes = await fetch("/api/gateway/rules").then(r => r.json());
  const rules = rulesRes.result || [];
  
  // Find all CZGS related rules (DNS and SNI based)
  const czgsRules = rules.filter(r => r.name.startsWith("CZGS Filter Lists"));

  if (czgsRules.length > 0) {
    log(`Deleting ${czgsRules.length} firewall rule(s)...`);
    let ruleCount = 0;
    for (const rule of czgsRules) {
      emitProgress("reset", ruleCount, czgsRules.length, `Deleting rule: ${rule.name}...`);
      const delRuleRes = await fetch(`/api/gateway/rules/${rule.id}`, { method: "DELETE" }).then(r => r.json());
      if (!delRuleRes.success) {
        log(`Warning: Failed to delete rule ${rule.name}`);
      }
      ruleCount++;
    }
  }

  log("Fetching lists...");
  emitProgress("reset", 0, 1, "Fetching lists...");
  const listsRes = await fetch("/api/gateway/lists").then(r => r.json());
  const lists = listsRes.result || [];
  const czgsLists = lists.filter(l => l.name.startsWith("CZGS List"));

  log(`Deleting ${czgsLists.length} Gateway list(s)...`);
  let listCount = 0;
  for (const list of czgsLists) {
    emitProgress("reset", listCount, czgsLists.length, `Deleting list: ${list.name}...`);
    const delRes = await fetch(`/api/gateway/lists/${list.id}`, { method: "DELETE" }).then(r => r.json());
    if (!delRes.success) {
      log(`Warning: Failed to delete list ${list.name}`);
    }
    listCount++;
  }
  emitProgress("reset", listCount, czgsLists.length, "All CZGS lists deleted.");

  log("Full reset complete. Clean state achieved!");
  emitProgress("complete", 1, 1, "Full reset complete!");
}
