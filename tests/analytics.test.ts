import { afterEach, describe, expect, it } from "vitest";
import { isBot, parseUserAgent } from "../src/lib/analytics/ua";
import { analyticsCookieValue, isAnalyticsCookie, isAnalyticsKey } from "../src/lib/analytics/auth";
import { bucketKey, bucketKeys, bucketLabel } from "../src/lib/analytics/queries";
import { locate } from "../src/lib/analytics/geo";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const WIN_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.5; rv:143.0) Gecko/20100101 Firefox/143.0";

describe("user agents", () => {
  it("classifies device, browser and OS", () => {
    expect(parseUserAgent(IPHONE)).toEqual({ device: "mobile", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(ANDROID_CHROME)).toEqual({ device: "mobile", browser: "Chrome", os: "Android" });
    expect(parseUserAgent(IPAD)).toEqual({ device: "tablet", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(WIN_EDGE)).toEqual({ device: "desktop", browser: "Edge", os: "Windows" });
    expect(parseUserAgent(MAC_FIREFOX)).toEqual({ device: "desktop", browser: "Firefox", os: "macOS" });
  });
  it("drops bots, scripts and missing user agents", () => {
    for (const ua of ["Googlebot/2.1", "Mozilla/5.0 HeadlessChrome/141.0", "curl/8.5.0", "python-requests/2.32", "", null])
      expect(isBot(ua)).toBe(true);
    expect(isBot(IPHONE)).toBe(false);
  });
});

describe("hidden page access", () => {
  const saved = process.env.ANALYTICS_KEY;
  afterEach(() => {
    process.env.ANALYTICS_KEY = saved;
  });
  it("accepts only the configured key, and the cookie isn't the key itself", () => {
    process.env.ANALYTICS_KEY = "0123456789abcdef0123456789abcdef";
    expect(isAnalyticsKey("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isAnalyticsKey("0123456789abcdef0123456789abcdee")).toBe(false);
    expect(isAnalyticsKey("")).toBe(false);
    const cookie = analyticsCookieValue()!;
    expect(cookie).not.toContain("0123456789abcdef");
    expect(isAnalyticsCookie(cookie)).toBe(true);
    expect(isAnalyticsCookie("0123456789abcdef0123456789abcdef")).toBe(false);
  });
  it("stays closed when no key (or a too-short one) is configured", () => {
    for (const k of [undefined, "", "short"]) {
      if (k === undefined) delete process.env.ANALYTICS_KEY;
      else process.env.ANALYTICS_KEY = k;
      expect(isAnalyticsKey(k ?? "anything")).toBe(false);
      expect(isAnalyticsCookie(analyticsCookieValue())).toBe(false);
    }
  });
});

describe("time buckets (Central)", () => {
  it("keys in Central time", () => {
    expect(bucketKey(new Date("2026-10-21T03:30:00Z"), "day")).toBe("2026-10-20"); // 10:30 PM CDT
    expect(bucketKey(new Date("2026-10-21T03:30:00Z"), "hour")).toBe("2026-10-20T22");
    expect(bucketLabel("2026-10-20T22", "hour")).toBe("Oct 20, 10 PM");
    expect(bucketLabel("2026-10-20", "day")).toBe("Oct 20");
  });
  it("gives every day exactly once across the Nov 1 DST change", () => {
    const keys = bucketKeys(new Date("2026-10-30T12:00:00Z"), new Date("2026-11-03T12:00:00Z"), "day");
    expect(keys).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    const hours = bucketKeys(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-20T23:00:00Z"), "hour");
    expect(hours).toHaveLength(24);
  });
});

describe("geolocation", () => {
  it("returns nothing (rather than failing) for private addresses, junk, or a missing database", async () => {
    expect(await locate("127.0.0.1")).toEqual({});
    expect(await locate("not an ip")).toEqual({});
    expect(await locate(undefined)).toEqual({});
  });
});
