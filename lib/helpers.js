import {
  API_HOST,
} from "./constants.js";
import { fetchRetry } from "./utils.js";

/**
 * Reads a credential from the Worker env at call time (not module load time).
 * Strips any BOM / whitespace that might have been injected via secret upload.
 */
function getCredential(key) {
  const raw = (globalThis.CZGS_ENV && globalThis.CZGS_ENV[key]) || '';
  return String(raw).replace(/^\uFEFF/, '').trim();
}

/**
 * Fires request to the specified URL.
 * @param {string} url The URL to which the request will be fired.
 * @param {RequestInit} options The options to be passed to `fetch`.
 * @returns {Promise}
 */
const request = async (url, options) => {
  const token = getCredential('CLOUDFLARE_API_TOKEN');
  if (!token) {
    throw new Error(
      "The following secrets are required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID"
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
  };
  let data;

  try {
    const response = await fetchRetry(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        ...headers,
      },
    });

    data = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return data;
  } catch (error) {
    const errorMessage = (data && typeof data === 'object' && 'errors' in data && Array.isArray(data.errors) && data.errors.length > 0)
      ? data.errors[0].message
      : error.message;
    throw new Error(`Request failed: ${errorMessage}`);
  }
};

/**
 * Fires request to the Zero Trust gateway.
 * @param {string} path The path which will be appended to the request URL.
 * @param {RequestInit} options The options to be passed to `fetch`.
 * @returns {Promise}
 */
export const requestGateway = (path, options) => {
  const accountId = getCredential('CLOUDFLARE_ACCOUNT_ID');
  return request(`${API_HOST}/accounts/${accountId}/gateway${path}`, options);
};

/**
 * Normalizes a domain.
 * @param {string} value The value to be normalized.
 * @param {boolean} isAllowlisting Whether the value is to be allowlisted.
 * @returns {string}
 */
export const normalizeDomain = (value, isAllowlisting) => {
  const init = (isAllowlisting) ? value.replace("@@||", "") : value;
  const normalized = init
    .replace(/(0\.0\.0\.0|127\.0\.0\.1|::1|::)\s+/, "")
    .replace("||", "")
    .replace("^$important", "")
    .replace("*.", "")
    .replace("^", "");

  return normalized;
};
