/**
 * Access to the hidden /analytics page. Opening /analytics?key=<ANALYTICS_KEY> once sets a cookie; without a valid
 * key or cookie the page answers like any URL that doesn't exist (404). The cookie holds a hash, not the key.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const ANALYTICS_COOKIE = "nsaa_analytics";

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** The configured key, if it's long enough to be a secret (deploy/install.sh generates 48 hex chars). */
function configuredKey(): string | undefined {
  const key = process.env.ANALYTICS_KEY?.trim();
  return key && key.length >= 16 ? key : undefined;
}

export function isAnalyticsKey(given: string | null | undefined): boolean {
  const key = configuredKey();
  return !!key && !!given && sameSecret(given, key);
}

export function analyticsCookieValue(): string | undefined {
  const key = configuredKey();
  return key && createHash("sha256").update(`nsaa-analytics:${key}`).digest("hex");
}

export function isAnalyticsCookie(value: string | null | undefined): boolean {
  const want = analyticsCookieValue();
  return !!want && !!value && sameSecret(value, want);
}
