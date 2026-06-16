import { BLOCK_PAGE_ENABLED, CZGS_API_CONCURRENCY, DEBUG, GATEWAY_PATCH_CHUNK_SIZE, LIST_ITEM_SIZE } from "./constants.js";
import { requestGateway } from "./helpers.js";
import { runWithConcurrency } from "./concurrency.js";
import { warnIfWirefilterExpressionLarge } from "./wirefilter-guard.js";

const NOW_STR = new Date().toISOString();

/**
 * Gets Zero Trust lists.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-list-zero-trust-lists
 * @returns {Promise<Object>}
 */
export const getZeroTrustLists = () =>
  requestGateway("/lists", {
    method: "GET",
  });

const isManagedGatewayList = ({ name }) =>
  name.startsWith("CZGS List");

/**
 * Gets Zero Trust list items
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-zero-trust-list-items
 * @param {string} id The id of the list.
 * @returns {Promise<Object>}
 */
const getZeroTrustListItemsPage = (id, page) =>
  requestGateway(`/lists/${id}/items?per_page=${LIST_ITEM_SIZE}&page=${page}`, {
    method: "GET",
  });

export const getZeroTrustListItems = async (id) => {
  const allItems = [];
  let page = 1;
  let totalPages = 1;
  let totalCount = 0;

  do {
    const response = await getZeroTrustListItemsPage(id, page);
    const items = response.result ?? [];
    const resultInfo = response.result_info ?? {};

    allItems.push(...items);
    totalPages = resultInfo.total_pages ?? totalPages;
    totalCount = resultInfo.total_count ?? allItems.length;

    if (page === 1) {
      console.log(`Fetching ${totalCount} item(s) across ${totalPages} page(s) for Gateway list ${id}`);
    }

    page++;
  } while (page <= totalPages);

  console.log(`Fetched ${allItems.length} item(s) across ${totalPages} page(s) for Gateway list ${id}`);

  return {
    result: allItems,
    result_info: {
      total_count: totalCount,
      total_pages: totalPages,
    },
  };
};

export const getZeroTrustListItemValues = async (id) => {
  const { result } = await getZeroTrustListItems(id);
  return (result ?? []).map((item) => item.value);
};


/**
 * Creates a Zero Trust list.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-create-zero-trust-list
 * @param {string} name The name of the list.
 * @param {Object[]} items The domains in the list.
 * @param {string} items[].value The domain of an entry.
 * @returns {Promise}
 */
const createZeroTrustList = (name, items) =>
  requestGateway(`/lists`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: "DOMAIN",
      items,
    }),
  });

/**
 * Patches an existing list. Remove/append entries to the list.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-patch-zero-trust-list
 * @param {string} listId The ID of the list to patch
 * @param {Object} patch The changes to make
 * @param {string[]} patch.remove A list of the item values you want to remove.
 * @param {Object[]} patch.append Items to add to the list.
 * @param {string} patch.append[].value The domain of an entry.
 * @returns
 */
const patchExistingList = (listId, patch) =>
  requestGateway(`/lists/${listId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

/**
 * Patches a list with chunked append/remove operations.
 * Splits large patches into multiple requests to avoid body size limits.
 * Processes sequentially to respect rate limits.
 * @param {string} listId The ID of the list to patch
 * @param {Object} patch The changes to make
 * @param {string[]} patch.remove A list of the item values you want to remove
 * @param {Object[]} patch.append Items to add to the list
 * @param {string} listName Optional list name for logging
 */
export const patchExistingListChunked = async (listId, patch, listName = listId) => {
  const remove = patch.remove || [];
  const append = patch.append || [];

  if (remove.length === 0 && append.length === 0) {
    return;
  }

  const totalRemoveChunks = Math.ceil(remove.length / GATEWAY_PATCH_CHUNK_SIZE);
  const totalAppendChunks = Math.ceil(append.length / GATEWAY_PATCH_CHUNK_SIZE);
  const totalChunks = totalRemoveChunks + totalAppendChunks;

  if (totalChunks <= 1) {
    await patchExistingList(listId, patch);
    return;
  }

  let chunkNum = 1;

  for (let i = 0; i < remove.length; i += GATEWAY_PATCH_CHUNK_SIZE) {
    const chunk = { remove: remove.slice(i, i + GATEWAY_PATCH_CHUNK_SIZE) };
    console.log(`  Patching ${listName}: chunk ${chunkNum}/${totalChunks} (${chunk.remove.length} removals)`);
    await patchExistingList(listId, chunk);
    chunkNum++;
  }

  for (let i = 0; i < append.length; i += GATEWAY_PATCH_CHUNK_SIZE) {
    const chunk = { append: append.slice(i, i + GATEWAY_PATCH_CHUNK_SIZE) };
    console.log(`  Patching ${listName}: chunk ${chunkNum}/${totalChunks} (${chunk.append.length} additions)`);
    await patchExistingList(listId, chunk);
    chunkNum++;
  }
};

/**
 * Synchronize Zero Trust lists.
 * @param {string[]} items The domains.
 */
export const synchronizeZeroTrustLists = async (items) => {
  const itemSet = new Set(items);

  console.log("Checking existing lists...");
  const { result: lists } = await getZeroTrustLists();
  const czgsLists = lists?.filter(isManagedGatewayList) || [];
  console.log(`Found ${czgsLists.length} existing lists. Calculating diffs...`);

  console.log(`Fetching items from ${czgsLists.length} lists with concurrency ${CZGS_API_CONCURRENCY}...`);
  const domainsByList = {};
  await runWithConcurrency(
    czgsLists,
    async (list) => {
      const { result: listItems } = await getZeroTrustListItems(list.id);
      domainsByList[list.id] = listItems?.map(item => item.value) || [];
    },
    {
      concurrency: CZGS_API_CONCURRENCY,
      onProgress: (completed, total) => {
        console.log(`  Fetched ${completed}/${total} lists...`);
      },
    }
  );

  const existingDomains = Object.fromEntries(
    Object.entries(domainsByList).flatMap(([id, domains]) => domains.map(d => [d, id]))
  );

  const toRemove = Object.fromEntries(
    Object.entries(existingDomains).filter(([domain]) => !itemSet.has(domain))
  );

  const toAdd = items.filter(domain => !existingDomains[domain]);

  console.log(`${Object.keys(toRemove).length} removals, ${toAdd.length} additions to make`);

  const removalPatches = Object.entries(toRemove).reduce((acc, [domain, listId]) => {
    acc[listId] = acc[listId] || { remove: [] };
    acc[listId].remove.push(domain);
    return acc;
  }, {});

  const patches = Object.fromEntries(
    Object.entries(removalPatches).map(([listId, patch]) => {
      const spaceInList = LIST_ITEM_SIZE - (domainsByList[listId].length - patch.remove.length);
      const append = Array(spaceInList)
        .fill(0)
        .map(() => toAdd.shift())
        .filter(Boolean)
        .map(domain => ({ value: domain, description: NOW_STR }));
      return [listId, { ...patch, append }];
    })
  );

  if (toAdd.length) {
    const unpatchedListIds = Object.keys(domainsByList).filter(listId => !patches[listId]);
    unpatchedListIds.forEach(listId => {
      const spaceInList = LIST_ITEM_SIZE - domainsByList[listId].length;
      if (spaceInList > 0) {
        const append = Array(spaceInList)
          .fill(0)
          .map(() => toAdd.shift())
          .filter(Boolean)
          .map(domain => ({ value: domain, description: NOW_STR }));

        if (append.length) {
          patches[listId] = { append };
        }
      }
    });
  }

  const patchEntries = Object.entries(patches);
  const totalPatches = patchEntries.length;
  
  let patchNum = 0;
  for(const [listId, patch] of patchEntries) {
    patchNum++;
    const appends = !!patch.append ? patch.append.length : 0;
    const removals = !!patch.remove ? patch.remove.length : 0;
    const listName = czgsLists.find(list => list.id === listId)?.name || listId;
    console.log(`Updating list "${listName}"${appends ? `, ${appends} additions` : ''}${removals ? `, ${removals} removals` : ''}`);
    await patchExistingListChunked(listId, patch, listName);
  }

  if (toAdd.length) {
    const nextListNumber = Math.max(0, ...czgsLists.map(list => parseInt(list.name.replace('CZGS List - Chunk ', ''))).filter(x => Number.isInteger(x))) + 1;
    await createZeroTrustListsOneByOne(toAdd, nextListNumber);
  }
};

/**
 * Defragment Zero Trust lists.
 * @returns {Promise<Object>}
 */
export const defragmentZeroTrustLists = async ({ onProgress } = {}) => {
  const emitProgress = (phase, current, total, message) => {
    onProgress?.({ phase, current, total, message });
  };

  console.log("Checking existing lists...");
  const { result: lists } = await getZeroTrustLists();
  const czgsLists = lists?.filter(({ name }) => name.startsWith("CZGS List - Chunk ")) || [];
  console.log(`Found ${czgsLists.length} existing lists. Downloading...`);
  emitProgress("fetch", 0, Math.max(czgsLists.length, 1), `Fetching ${czgsLists.length} lists...`);

  czgsLists.sort((a, b) => {
    const aNum = parseInt(a.name.replace("CZGS List - Chunk ", ""));
    const bNum = parseInt(b.name.replace("CZGS List - Chunk ", ""));
    return aNum - bNum;
  });

  console.log(`Fetching items from ${czgsLists.length} lists with concurrency ${CZGS_API_CONCURRENCY}...`);
  const allEntries = [];
  const listItemsResults = await runWithConcurrency(
    czgsLists,
    async (list) => {
      const { result: listItems } = await getZeroTrustListItems(list.id);
      return listItems?.map(item => ({
        ...item,
        originListId: list.id,
        description: isNaN(new Date(item.description)) ? NOW_STR : item.description,
      })) || [];
    },
    {
      concurrency: CZGS_API_CONCURRENCY,
      onProgress: (completed, total) => {
        console.log(`  Fetched ${completed}/${total} lists...`);
        emitProgress("fetch", completed, total, `Fetched ${completed}/${total} lists...`);
      },
    }
  );
  for (const items of listItemsResults) {
    allEntries.push(...items);
  }

  console.log(`Found ${allEntries.length} entries in ${czgsLists.length} lists`);

  allEntries.sort((a, b) => {
    const createdAtA = new Date(a.description);
    const createdAtB = new Date(b.description);
    if (createdAtA.getTime() === createdAtB.getTime()) {
      return a.value.localeCompare(b.value);
    }
    return createdAtA - createdAtB;
  });

  const assignedEntries = allEntries.map((entry, index) => {
    const listIndex = Math.floor(index / LIST_ITEM_SIZE);
    const assignedListId = czgsLists[listIndex]?.id || null;
    if (!assignedListId) {
      throw new Error(`Unable to resolve list for entry ${index}, have only ${czgsLists.length} lists`);
    }
    return { ...entry, assignedListId };
  });

  const entriesToMove = assignedEntries.filter(entry => entry.originListId !== entry.assignedListId);

  const patches = {};
  for (const entry of entriesToMove) {
    const { originListId, assignedListId, ...gatewayItem } = entry;
    if (!patches[originListId]) {
      patches[originListId] = { append: [], remove: [] };
    }
    patches[originListId].remove.push(gatewayItem.value);

    if (!patches[assignedListId]) {
      patches[assignedListId] = { append: [], remove: [] };
    }
    patches[assignedListId].append.push(gatewayItem);
  }

  console.log(`Found ${Object.keys(patches).length} patches to make, moving ${entriesToMove.length} entries...`);

  const patchEntries = Object.entries(patches);
  const totalPatches = patchEntries.length;
  emitProgress("defrag", 0, Math.max(totalPatches, 1), `Defragmenting ${totalPatches} lists...`);

  let patchNum = 0;
  for(const [listId, patch] of patchEntries) {
    patchNum++;
    const appends = !!patch.append ? patch.append.length : 0;
    const removals = !!patch.remove ? patch.remove.length : 0;
    const listName = czgsLists.find(list => list.id === listId)?.name || listId;
    console.log(`Updating list "${listName}"${appends ? `, ${appends} additions` : ''}${removals ? `, ${removals} removals` : ''}`);
    emitProgress("defrag", patchNum, totalPatches, `Patching "${listName}" (${appends} adds, ${removals} removes)`);
    await patchExistingListChunked(listId, patch, listName);
  }

  emitProgress("defrag", Math.max(totalPatches, 1), Math.max(totalPatches, 1), `Defragment complete - ${entriesToMove.length} entries moved`);

  const assignedLists = new Set();
  assignedEntries.forEach(entry => assignedLists.add(entry.assignedListId));
  const emptyLists = czgsLists.filter(list => !assignedLists.has(list.id));
  const nonEmptyLists = lists.filter(list => !emptyLists.some(emptyList => emptyList.id === list.id));

  return {
    emptyLists,
    nonEmptyLists,
    stats: {
      assignedLists: assignedLists.size,
      emptyLists: emptyLists.length,
      nonEmptyLists: nonEmptyLists.length,
      entriesToMove: entriesToMove.length,
      patches: Object.keys(patches).length,
      allEntries: allEntries.length,
      chunks: czgsLists.length,
    }
  };
}

/**
 * Creates Zero Trust lists sequentially.
 * @param {string[]} items The domains.
 * @param {Number} [startingListNumber] The chunk number to start from when naming lists.
 */
export const createZeroTrustListsOneByOne = async (items, startingListNumber = 1) => {
  let totalListNumber = Math.ceil(items.length / LIST_ITEM_SIZE);

  for (let i = 0, listNumber = startingListNumber; i < items.length; i += LIST_ITEM_SIZE) {
    const chunk = items
      .slice(i, i + LIST_ITEM_SIZE)
      .map((item) => ({ value: item, description: NOW_STR }));
    const listName = `CZGS List - Chunk ${listNumber}`;

    try {
      await createZeroTrustList(listName, chunk);
      totalListNumber--;
      listNumber++;

      console.log(`Created "${listName}" list - ${totalListNumber} left`);
    } catch (err) {
      console.error(`Could not create "${listName}" - ${err.toString()}`);
      throw err;
    }
  }
};

/**
 * Deletes a Zero Trust list.
 * @param {number} id The ID of the list.
 * @returns {Promise<any>}
 */
const deleteZeroTrustList = (id) =>
  requestGateway(`/lists/${id}`, { method: "DELETE" });

/**
 * Deletes Zero Trust lists sequentially.
 * @param {Object[]} lists The lists to be deleted.
 */
export const deleteZeroTrustListsOneByOne = async (lists, { onProgress } = {}) => {
  let totalListNumber = lists.length;
  const total = lists.length;
  let completed = 0;

  for (const { id, name } of lists) {
    try {
      onProgress?.({ current: completed, total, listName: name, message: `Deleting ${name}...` });
      await deleteZeroTrustList(id);
      totalListNumber--;
      completed++;
      onProgress?.({ current: completed, total, listName: name, message: `Deleted ${name}` });

      console.log(`Deleted ${name} list - ${totalListNumber} left`);
    } catch (err) {
      console.error(`Could not delete ${name} - ${err.toString()}`);
      throw err;
    }
  }
};

/**
 * Gets Zero Trust rules.
 * @returns {Promise<Object>}
 */
export const getZeroTrustRules = () =>
  requestGateway("/rules", { method: "GET" });

/**
 * Upserts a Zero Trust rule.
 * @param {string} wirefilterExpression The expression to be used for the rule.
 * @param {string} name The name of the rule.
 * @param {string[]} filters The filters to be used for the rule.
 * @returns {Promise<Object>}
 */
export const upsertZeroTrustRule = async (wirefilterExpression, name = "CZGS Filter Lists", filters = ["dns"]) => {
  const { result: existingRules} = await getZeroTrustRules();
  const existingRule = existingRules.find(rule => rule.name === name);
  if (existingRule) {
    if (DEBUG) console.log(`Found "${existingRule.name}" in rules, updating...`);
    return updateZeroTrustRule(existingRule.id, wirefilterExpression, name, filters);
  }
  if (DEBUG) console.log(`No existing rule named "${name}", creating...`);
  return createZeroTrustRule(wirefilterExpression, name, filters);
}

/**
 * Creates a Zero Trust rule.
 * @param {string} wirefilterExpression The expression to be used for the rule.
 * @param {string} name The name of the rule.
 * @param {string[]} filters The filters to be used for the rule.
 * @returns {Promise<Object>}
 */
export const createZeroTrustRule = async (wirefilterExpression, name = "CZGS Filter Lists", filters = ["dns"]) => {
  try {
    await requestGateway("/rules", {
      method: "POST",
      body: JSON.stringify({
        name,
        description:
          "Filter lists created by Cloudflare Gateway Pi-hole Scripts. Avoid editing this rule. Changing the name of this rule will break the script.",
        enabled: true,
        action: "block",
        rule_settings: { "block_page_enabled": BLOCK_PAGE_ENABLED, "block_reason": "Blocked by CZGS, check your filter lists if this was a mistake." },
        filters,
        traffic: wirefilterExpression,
      }),
    });

    console.log("Created rule successfully");
  } catch (err) {
    console.error(`Error occurred while creating rule - ${err.toString()}`);
    throw err;
  }
};

/**
 * Updates a Zero Trust rule.
 * @param {number} id The ID of the rule to be updated.
 * @param {string} wirefilterExpression The expression to be used for the rule.
 * @param {string} name The name of the rule.
 * @param {string[]} filters The filters to be used for the rule.
 * @returns {Promise<Object>}
 */
export const updateZeroTrustRule = async (id, wirefilterExpression, name = "CZGS Filter Lists", filters = ["dns"]) => {
  try {
    await requestGateway(`/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        description:
          "Filter lists created by Cloudflare Gateway Pi-hole Scripts. Avoid editing this rule. Changing the name of this rule will break the script.",
        action: "block",
        enabled: true,
        rule_settings: { "block_page_enabled": BLOCK_PAGE_ENABLED, "block_reason": "Blocked by CZGS, check your filter lists if this was a mistake." },
        filters,
        traffic: wirefilterExpression,
      }),
    });

    console.log("Updated existing rule successfully");
  } catch (err) {
    console.error(`Error occurred while updating rule - ${err.toString()}`);
    throw err;
  }
};

/**
 * Deletes a Zero Trust rule.
 * @param {number} id The ID of the rule to be deleted.
 * @returns {Promise<Object>}
 */
export const deleteZeroTrustRule = async (id) => {
  try {
    await requestGateway(`/rules/${id}`, {
      method: "DELETE",
    });

    console.log("Deleted rule successfully");
  } catch (err) {
    console.error(`Error occurred while deleting rule - ${err.toString()}`);
    throw err;
  }
};

/**
 * Creates or Updates Zero Trust DNS rule for a given array of lists.
 * @param {object[]} lists The lists to be used for the rule.
 * @param {string} listName The name of the list.
 */
export const upsertZeroTrustDNSRule = async (lists, listName) => {
  const managedLists = lists.filter(isManagedGatewayList);

  if (managedLists.length === 0) {
    console.log("No CZGS lists found. Skipping DNS rule creation.");
    return;
  }

  const wirefilterDNSExpression = managedLists
    .map(({ id }) => `any(dns.domains[*] in \$${id})`)
    .join(" or ");
  warnIfWirefilterExpressionLarge(wirefilterDNSExpression, {
    listCount: managedLists.length,
    ruleLabel: "DNS",
  });
  console.log("Checking DNS rule...");
  await upsertZeroTrustRule(wirefilterDNSExpression, listName, ["dns"]);
};

/**
 * Creates or Updates Zero Trust SNI rule for a given array of lists.
 * @param {object[]} lists The lists to be used for the rule.
 * @param {string} listName The name of the list.
 */
export const upsertZeroTrustSNIRule = async (lists, listName) => {
  const managedLists = lists.filter(isManagedGatewayList);

  if (managedLists.length === 0) {
    console.log("No CZGS lists found. Skipping SNI rule creation.");
    return;
  }

  const wirefilterSNIExpression = managedLists
    .map(({ id }) => `any(net.sni.domains[*] in \$${id})`)
    .join(" or ");
  warnIfWirefilterExpressionLarge(wirefilterSNIExpression, {
    listCount: managedLists.length,
    ruleLabel: "SNI",
  });
  console.log("Creating SNI rule...");
  await upsertZeroTrustRule(wirefilterSNIExpression, listName, ["l4"]);
};
