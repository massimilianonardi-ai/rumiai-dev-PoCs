import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const probePath = fileURLToPath(new URL('./probe.mjs', import.meta.url));

/** Extract a wishlist observation through the existing web-control PoC. */
export async function extract(wishlistUrl, options = {}) {
  if (typeof wishlistUrl !== 'string' || !wishlistUrl.trim()) {
    throw new TypeError('wishlistUrl must be a non-empty string');
  }
  const url = new URL(wishlistUrl);
  if (!/(^|\.)amazon\.it$/i.test(url.hostname) ||
      !/^\/hz\/wishlist\/ls(?:\/|$)/i.test(url.pathname)) {
    throw new TypeError('wishlistUrl must be an Amazon.it wishlist URL');
  }
  const { webControlCommand, scrollWaitMs, stableRounds, maxRounds,
    timeoutMs = 300000 } = options;
  const env = { ...process.env };
  if (webControlCommand !== undefined) env.WEB_CONTROL_CMD = String(webControlCommand);
  for (const [key, value] of [
    ['AMAZON_SCROLL_WAIT_MS', scrollWaitMs],
    ['AMAZON_STABLE_ROUNDS', stableRounds],
    ['AMAZON_MAX_ROUNDS', maxRounds]
  ]) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(key + ' must be a positive integer');
    }
    env[key] = String(value);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, [probePath, url.href], {
      env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (error) {
    // Incomplete/blocked observations retain their structured evidence.
    if (error.stdout) {
      try {
        const result = JSON.parse(error.stdout);
        if (typeof result.complete === 'boolean' && typeof result.blocked === 'boolean') {
          return result;
        }
      } catch { /* Preserve the original failure. */ }
    }
    throw error;
  }
}
