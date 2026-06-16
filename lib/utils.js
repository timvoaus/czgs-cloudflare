import { CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME, RATE_LIMITING_HTTP_ERROR_CODE } from "./constants.js";

/**
 * Checks if the value is a valid domain.
 * @param {string} value The value to be checked.
 */
export const isValidDomain = (value) =>
  /^\b((?=[a-z0-9-]{1,63}\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,63}\b$/.test(
    value
  );

/**
 * Extracts all subdomains from a domain including itself.
 * @param {string} domain The domain to be extracted.
 * @returns {string[]}
 */
export const extractDomain = (domain) => {
  const parts = domain.split(".");
  const extractedDomains = [];

  for (let i = 0; i < parts.length; i++) {
    const subdomains = parts.slice(i).join(".");

    extractedDomains.unshift(subdomains);
  }

  return extractedDomains;
};

/**
 * Checks if the value is a comment.
 * @param {string} value The value to be checked.
 */
export const isComment = (value) =>
  value.startsWith("#") ||
  value.startsWith("//") ||
  value.startsWith("!") ||
  value.startsWith("/*") ||
  value.startsWith("*/");

/**
 * Waits for a period of time
 * @param {number} ms The time to wait in milliseconds.
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches with retry
 * @param  {Parameters<typeof fetch>} args
 */
export const fetchRetry = async (...args) => {
  let attempts = 0;
  const maxAttempts = 10; // Reduced for worker limits
  let response;

  while (attempts < maxAttempts) {
    try {
      response = await fetch(...args);

      if (response.ok) {
        return response;
      }

      const status = response.status;
      if (status === RATE_LIMITING_HTTP_ERROR_CODE || (status >= 500 && status <= 504)) {
        throw new Error(`HTTP error! Status: ${status}`);
      }

      return response;
    } catch (error) {
      attempts++;
      const status = response?.status;
      const isRateLimit = status === RATE_LIMITING_HTTP_ERROR_CODE;

      console.warn(
        `Fetch retry attempt ${attempts} of ${maxAttempts} due to: "${error.message}"`
      );

      if (attempts >= maxAttempts) {
        throw error;
      }

      if (isRateLimit) {
        // Wait for rate limit cooldown
        await wait(CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME);
      } else {
        await wait(1000 * attempts);
      }
    }
  }
};
