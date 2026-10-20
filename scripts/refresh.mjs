/**
 * Ask the running app to scrape NSAA and store a fresh snapshot set (GET /api/refresh).
 * Talks to the app directly on 127.0.0.1:PORT — nginx blocks /api/refresh from the outside.
 * Run hourly by the PM2 "<SERVICE_NAME>-refresh" process (ecosystem.config.cjs), which also starts it alongside the
 * app — so wait for the app to come up before giving up.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const port = process.env.PORT || "3000";
const url = `http://127.0.0.1:${port}/api/refresh`;

let res;
for (let attempt = 1; ; attempt++) {
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      signal: AbortSignal.timeout(5 * 60_000),
    });
    break;
  } catch (e) {
    // Only "connection refused" (app still booting) is worth retrying; timeouts and the like are real failures.
    if (attempt >= 24 || e?.cause?.code !== "ECONNREFUSED") throw e;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const body = await res.text();
console.log(`${res.status} ${body.slice(0, 500)}`);
if (!res.ok) process.exit(1);
