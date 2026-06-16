import { D1DatabaseWrapper } from '../lib/db-client.js';
import {
  initDNSAnalytics,
  syncDNSAnalyticsToDatabase,
  buildDNSAnalyticsDataFromCache,
} from '../lib/server/dns-analytics.js';
import {
  initTrafficMap,
  syncTrafficMapAggregatesToDatabase,
  getTrafficMapDataResponse,
} from '../lib/server/traffic-map.js';
import {
  getZeroTrustLists,
  getZeroTrustListItems,
  patchExistingListChunked,
  getZeroTrustRules,
} from '../lib/api.js';
import {
  findCustomAllowlist,
  findCustomDenylist,
  upsertAllowRule,
  upsertDenyRule,
  CUSTOM_ALLOWLIST_NAME,
  CUSTOM_DENYLIST_NAME,
} from '../lib/server/custom-gateway.js';
import {
  isDnsRewriteRuleName,
  serializeDnsRewriteRule,
  parseRewriteLines,
  upsertDnsRewriteRule,
  DNS_REWRITE_RULE_PREFIX,
} from '../lib/server/dns-rewrite.js';
import {
  detectGatewayLocationId,
  serializeGatewayLocationIpv4,
  buildGatewayLocationUpdatePayload,
} from '../lib/server/gateway-location.js';
import { requestGateway } from '../lib/helpers.js';

// Helper to return JSON responses with proper CORS headers
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
  });
}

// Basic Authentication helper
function checkAuthentication(request, env) {
  const authDisabled = env.DASHBOARD_AUTH_DISABLED === '1';
  if (authDisabled) return true;

  // Sanitize by removing BOM characters and trailing/leading whitespaces/newlines/carriage returns
  // Defensively check for keys with trailing spaces (e.g. 'DASHBOARD_PASSWORD ') due to CLI/shell input mismatches
  const rawPassword = env.DASHBOARD_PASSWORD || env['DASHBOARD_PASSWORD '] || 'admin';
  const rawUser = env.DASHBOARD_USERNAME || env['DASHBOARD_USERNAME '] || 'admin';
  const password = String(rawPassword).replace(/^\uFEFF/, '').trim();
  const expectedUser = String(rawUser).replace(/^\uFEFF/, '').trim();

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  try {
    const base64Part = authHeader.split(' ')[1];
    const credentials = atob(base64Part);
    const separatorIndex = credentials.indexOf(':');
    if (separatorIndex === -1) return false;
    
    const user = credentials.substring(0, separatorIndex).trim();
    const pass = credentials.substring(separatorIndex + 1);
    
    return user === expectedUser && pass === password;
  } catch {
    return false;
  }
}

export default {
  // HTTP Request handler
  async fetch(request, env, ctx) {
    // Set global environment for API / constants resolution
    globalThis.CZGS_ENV = env;

    // Handle OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // CORS Proxy endpoint does not require auth (public domain fetcher)
    const urlObj = new URL(request.url);
    if (urlObj.pathname === '/api/proxy') {
      const targetUrl = urlObj.searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing target URL' }, 400);
      }
      try {
        const fetchRes = await fetch(targetUrl);
        const text = await fetchRes.text();
        return new Response(text, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': fetchRes.headers.get('Content-Type') || 'text/plain',
          },
        });
      } catch (err) {
        return new Response(`Error fetching URL: ${err.message}`, { status: 500 });
      }
    }

    // Authenticate all other endpoints
    if (!checkAuthentication(request, env)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Initialize D1 Database client wrapper and modules
    const db = new D1DatabaseWrapper(env.DB);
    const cleanAccountId = (env.CLOUDFLARE_ACCOUNT_ID || '').replace(/^\uFEFF/, '').trim();
    const cleanApiToken = (env.CLOUDFLARE_API_TOKEN || '').replace(/^\uFEFF/, '').trim();
    initDNSAnalytics({
      database: db,
      accountId: cleanAccountId,
      apiToken: cleanApiToken,
    });
    initTrafficMap({
      database: db,
      accountId: cleanAccountId,
      apiToken: cleanApiToken,
    });

    const path = urlObj.pathname;
    const method = request.method;

    try {
      // 1. Health & Configuration Check
      if (path === '/api/health' && method === 'GET') {
        const configOk = !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
        return jsonResponse({
          ok: true,
          cloudflareConfigured: configOk,
          databaseWritable: true,
          version: '1.0.0-cf',
        });
      }

      // 2. Settings (Save list URLs, configuration settings in D1)
      if (path === '/api/settings') {
        if (method === 'GET') {
          const rows = await db.prepare('SELECT key, value FROM settings').all();
          const settingsObj = {};
          for (const row of rows) {
            settingsObj[row.key] = row.value;
          }
          return jsonResponse({ success: true, settings: settingsObj });
        }
        if (method === 'POST') {
          const payload = await request.json();
          for (const [key, value] of Object.entries(payload)) {
            await db
              .prepare(
                'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
              )
              .run(key, String(value));
          }
          return jsonResponse({ success: true });
        }
      }

      // 3. DNS Analytics
      if (path === '/api/dns-analytics' && method === 'GET') {
        const range = urlObj.searchParams.get('range') || '24h';
        const refresh = urlObj.searchParams.get('refresh') === 'true';

        if (refresh) {
          // Caller wants live data: sync from Cloudflare API first, then return
          await syncDNSAnalyticsToDatabase(true);
          const data = await buildDNSAnalyticsDataFromCache(range);
          return jsonResponse({ success: true, data });
        }

        // Return cached data immediately
        const syncState = await db.prepare('SELECT last_synced_ts FROM sync_state WHERE key = ?').get('dns_analytics');
        if (!syncState) {
          // No cache at all — trigger background sync for next time
          ctx.waitUntil(syncDNSAnalyticsToDatabase(true));
        }
        const data = await buildDNSAnalyticsDataFromCache(range);
        return jsonResponse({ success: true, data });
      }

      // 4. Traffic Map
      if (path === '/api/traffic-map' && method === 'GET') {
        const range = urlObj.searchParams.get('range') || '24h';
        const refresh = urlObj.searchParams.get('refresh') === 'true';

        if (refresh) {
          // Caller wants live data: sync from Cloudflare GraphQL API first
          await syncTrafficMapAggregatesToDatabase();
          const data = await getTrafficMapDataResponse(range, 'live');
          return jsonResponse({ success: true, data });
        }

        // Return cached data immediately
        const syncState = await db.prepare('SELECT last_synced_ts FROM sync_state WHERE key = ?').get('traffic_map_graphql');
        if (!syncState) {
          ctx.waitUntil(syncTrafficMapAggregatesToDatabase());
        }
        const data = await getTrafficMapDataResponse(range, 'cache');
        return jsonResponse({ success: true, data });
      }

      // 5. Gateway Lists secure proxies (Used by client-side browser sync-engine)
      if (path === '/api/gateway/lists') {
        if (method === 'GET') {
          const listRes = await getZeroTrustLists();
          return jsonResponse(listRes);
        }
        if (method === 'POST') {
          const payload = await request.json();
          // Create list
          const createRes = await requestGateway('/lists', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          return jsonResponse(createRes);
        }
      }

      if (path.startsWith('/api/gateway/lists/') && path.endsWith('/items')) {
        const parts = path.split('/');
        const listId = parts[4];
        if (method === 'GET') {
          const itemsRes = await getZeroTrustListItems(listId);
          return jsonResponse(itemsRes);
        }
      }

      if (path.startsWith('/api/gateway/lists/') && method === 'DELETE') {
        const parts = path.split('/');
        const listId = parts[4];
        const delRes = await requestGateway(`/lists/${listId}`, { method: 'DELETE' });
        return jsonResponse(delRes);
      }

      if (path === '/api/gateway/patch' && method === 'POST') {
        const { listId, patch, listName } = await request.json();
        await patchExistingListChunked(listId, patch, listName);
        return jsonResponse({ success: true });
      }

      if (path === '/api/gateway/rules') {
        if (method === 'GET') {
          const rulesRes = await getZeroTrustRules();
          return jsonResponse(rulesRes);
        }
        if (method === 'POST') {
          const payload = await request.json();
          const ruleRes = await requestGateway('/rules', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          return jsonResponse(ruleRes);
        }
      }

      if (path.startsWith('/api/gateway/rules/') && method === 'PUT') {
        const parts = path.split('/');
        const ruleId = parts[4];
        const payload = await request.json();
        const ruleRes = await requestGateway(`/rules/${ruleId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        return jsonResponse(ruleRes);
      }

      if (path.startsWith('/api/gateway/rules/') && method === 'DELETE') {
        const parts = path.split('/');
        const ruleId = parts[4];
        const delRes = await requestGateway(`/rules/${ruleId}`, { method: 'DELETE' });
        return jsonResponse(delRes);
      }

      // 6. Custom Allowlist / Denylist management proxy
      if (path === '/api/gateway/custom-allowlist' && method === 'GET') {
        const { result: lists } = await getZeroTrustLists();
        let customList = findCustomAllowlist(lists);
        if (!customList) {
          const created = await requestGateway('/lists', {
            method: 'POST',
            body: JSON.stringify({
              name: CUSTOM_ALLOWLIST_NAME,
              type: 'DOMAIN',
              description: 'Custom allowlist managed by the dashboard',
              items: [],
            }),
          });
          customList = created.result;
        }
        await upsertAllowRule(customList.id);
        const itemsRes = await getZeroTrustListItems(customList.id);
        return jsonResponse({ id: customList.id, items: itemsRes.result || [] });
      }

      if (path === '/api/gateway/custom-denylist' && method === 'GET') {
        const { result: lists } = await getZeroTrustLists();
        let customList = findCustomDenylist(lists);
        if (!customList) {
          const created = await requestGateway('/lists', {
            method: 'POST',
            body: JSON.stringify({
              name: CUSTOM_DENYLIST_NAME,
              type: 'DOMAIN',
              description: 'Custom denylist managed by the dashboard',
              items: [],
            }),
          });
          customList = created.result;
        }
        await upsertDenyRule(customList.id);
        const itemsRes = await getZeroTrustListItems(customList.id);
        return jsonResponse({ id: customList.id, items: itemsRes.result || [] });
      }

      // 7. DNS Rewrites Proxy
      if (path === '/api/gateway/dns-rewrites') {
        if (method === 'GET') {
          const { result: rules } = await getZeroTrustRules();
          const rewrites = (rules ?? [])
            .filter(({ name }) => isDnsRewriteRuleName(name))
            .map(serializeDnsRewriteRule)
            .filter(({ domain, ips }) => domain && ips.length > 0)
            .sort((a, b) => a.domain.localeCompare(b.domain));
          return jsonResponse({ rewrites });
        }
        if (method === 'POST') {
          const { raw } = await request.json();
          const { entries, invalid } = parseRewriteLines(raw);
          if (invalid.length > 0) {
            return jsonResponse({ success: false, error: `Invalid syntax on line ${invalid[0].line}: ${invalid[0].reason}` }, 400);
          }

          const { result: rules } = await getZeroTrustRules();
          const existingRules = (rules ?? []).filter(({ name }) => isDnsRewriteRuleName(name));

          // Create/update rules for each entry
          for (const entry of entries) {
            const existing = existingRules.find(r => r.name === `${DNS_REWRITE_RULE_PREFIX}${entry.domain}`);
            await upsertDnsRewriteRule(entry, existing);
          }

          // Delete rewrite rules no longer in the list
          const activeDomains = new Set(entries.map(e => e.domain));
          for (const rule of existingRules) {
            const domain = rule.name.slice(DNS_REWRITE_RULE_PREFIX.length);
            if (!activeDomains.has(domain)) {
              await requestGateway(`/rules/${rule.id}`, { method: 'DELETE' });
            }
          }
          return jsonResponse({ success: true });
        }
      }

      // 8. Gateway Location Primary IPv4 Endpoints
      if (path === '/api/gateway/location-ipv4') {
        const locationId = env.CLOUDFLARE_GATEWAY_LOCATION_ID || (await detectGatewayLocationId(cleanAccountId, cleanApiToken));
        if (!locationId) {
          return jsonResponse({ error: 'Gateway location not found' }, 404);
        }

        if (method === 'GET') {
          const location = await requestGateway(`/locations/${locationId}`, { method: 'GET' });
          const serialized = serializeGatewayLocationIpv4(location.result);
          return jsonResponse({ success: true, locationId, serialized });
        }

        if (method === 'POST') {
          const { ipv4 } = await request.json();
          const location = await requestGateway(`/locations/${locationId}`, { method: 'GET' });
          const payload = buildGatewayLocationUpdatePayload(location.result, ipv4);
          const updateRes = await requestGateway(`/locations/${locationId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          return jsonResponse({ success: updateRes.success });
        }
      }

      // 9. Manual Sync Trigger (to bootstrap data)
      if (path === '/api/sync-logs' && method === 'GET') {
        const full = urlObj.searchParams.get('full') === 'true';
        await Promise.all([
          syncTrafficMapAggregatesToDatabase(),
          syncDNSAnalyticsToDatabase(full),
        ]);
        return jsonResponse({ success: true, message: 'Sync complete' });
      }

      // Route fallback
      return jsonResponse({ error: `Not found: ${path}` }, 404);
    } catch (err) {
      console.error(`Error processing route ${path}:`, err);
      return jsonResponse({ error: err.message }, 500);
    }
  },

  // Cron Trigger handler
  async scheduled(event, env, ctx) {
    globalThis.CZGS_ENV = env;
    const db = new D1DatabaseWrapper(env.DB);
    const cleanAccountId = (env.CLOUDFLARE_ACCOUNT_ID || '').replace(/^\uFEFF/, '').trim();
    const cleanApiToken = (env.CLOUDFLARE_API_TOKEN || '').replace(/^\uFEFF/, '').trim();
    initDNSAnalytics({
      database: db,
      accountId: cleanAccountId,
      apiToken: cleanApiToken,
    });
    initTrafficMap({
      database: db,
      accountId: cleanAccountId,
      apiToken: cleanApiToken,
    });

    console.log('Running scheduled analytics and traffic map background sync...');
    ctx.waitUntil(
      Promise.all([
        syncTrafficMapAggregatesToDatabase(),
        syncDNSAnalyticsToDatabase(true),
      ])
    );
  },
};
