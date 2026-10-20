/**
 * Ask the running app to scrape NSAA and store a fresh snapshot set (GET /api/refresh).
 * Talks to the app directly on 127.0.0.1:PORT — nginx blocks /api/refresh from the outside.
 * Run hourly by the systemd timer installed by deploy/install.sh.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const port = process.env.PORT || "3000";
const res = await fetch(`http://127.0.0.1:${port}/api/refresh`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  signal: AbortSignal.timeout(5 * 60_000),
});
const body = await res.text();
console.log(`${res.status} ${body.slice(0, 500)}`);
if (!res.ok) process.exit(1);
