// Constants for the Cloudflare Zerotrust Gateway Scripts (Worker/Cloudflare compatible)

const getEnv = (key, defaultValue) => {
  if (globalThis.CZGS_ENV && globalThis.CZGS_ENV[key] !== undefined) {
    return globalThis.CZGS_ENV[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }
  return defaultValue;
};

export const API_KEY = ""; // Not recommended, using API_TOKEN instead

export const API_TOKEN = String(getEnv("CLOUDFLARE_API_TOKEN", "")).replace(/^\uFEFF/, "").trim();

export const ACCOUNT_ID = String(getEnv("CLOUDFLARE_ACCOUNT_ID", "")).replace(/^\uFEFF/, "").trim();

export const ACCOUNT_EMAIL = "";

export const LIST_ITEM_LIMIT = isNaN(getEnv("CLOUDFLARE_LIST_ITEM_LIMIT"))
  ? 300000
  : parseInt(getEnv("CLOUDFLARE_LIST_ITEM_LIMIT"), 10);

export const LIST_ITEM_SIZE = 1000;

export const GATEWAY_PATCH_CHUNK_SIZE = isNaN(getEnv("GATEWAY_PATCH_CHUNK_SIZE"))
  ? 500
  : parseInt(getEnv("GATEWAY_PATCH_CHUNK_SIZE"), 10);

export const CZGS_API_CONCURRENCY = isNaN(getEnv("CZGS_API_CONCURRENCY"))
  ? 3
  : parseInt(getEnv("CZGS_API_CONCURRENCY"), 10);

export const CZGS_DOWNLOAD_CONCURRENCY = isNaN(getEnv("CZGS_DOWNLOAD_CONCURRENCY"))
  ? 3
  : parseInt(getEnv("CZGS_DOWNLOAD_CONCURRENCY"), 10);

export const CZGS_SKIP_SYNC_IF_UNCHANGED = parseInt(getEnv("CZGS_SKIP_SYNC_IF_UNCHANGED"), 10) !== 0;

export const CZGS_FORCE_SYNC = !!parseInt(getEnv("CZGS_FORCE_SYNC"), 10);

export const CZGS_AUTO_DEFRAGMENT = parseInt(getEnv("CZGS_AUTO_DEFRAGMENT"), 10) !== 0;

export const API_HOST = "https://api.cloudflare.com/client/v4";

export const DRY_RUN = !!parseInt(getEnv("DRY_RUN"), 10);

export const DELETION_ENABLED = !!getEnv("CZGS_DELETION_ENABLED");

export const BLOCK_PAGE_ENABLED = !!parseInt(getEnv("BLOCK_PAGE_ENABLED"), 10);

export const BLOCK_BASED_ON_SNI = !!parseInt(getEnv("BLOCK_BASED_ON_SNI"), 10);

export const DEBUG = !!parseInt(getEnv("DEBUG"), 10);

export const CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME = 2 * 60 * 1000;
export const RATE_LIMITING_HTTP_ERROR_CODE = 429;

export const PROCESSING_FILENAME = {
  ALLOWLIST: "allowlist.txt",
  BLOCKLIST: "blocklist.txt",
  OLD_ALLOWLIST: "whitelist.csv",
  OLD_BLOCKLIST: "input.csv",
};

export const LIST_TYPE = {
  ALLOWLIST: "allowlist",
  BLOCKLIST: "blocklist",
};

// Recommended lists (same as main repo)
export const RECOMMENDED_ALLOWLIST_URLS = [
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_45.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/banks.txt",
  "https://raw.githubusercontent.com/Dogino/Discord-Phishing-URLs/main/official-domains.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/mac.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/windows.txt",
  "https://raw.githubusercontent.com/boutetnico/url-shorteners/master/list.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/firefox.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/android.txt",
  "https://raw.githubusercontent.com/TogoFire-Home/AD-Settings/main/Filters/whitelist.txt",
  "https://raw.githubusercontent.com/DandelionSprout/AdGuard-Home-Whitelist/master/whitelist.txt",
  "https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exclusions.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/issues.txt",
];

export const RECOMMENDED_BLOCKLIST_URLS = [
  "https://raw.githubusercontent.com/bigdargon/hostsVN/master/filters/adservers-all.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_5.txt",
  "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/multi-onlydomains.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_16.txt",
];
