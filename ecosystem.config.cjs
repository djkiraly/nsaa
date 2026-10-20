/**
 * PM2 process list for production — deploy/install.sh runs `pm2 startOrReload ecosystem.config.cjs`.
 *
 *   <SERVICE_NAME>          the Next.js server (scripts/start.mjs listens on PORT/HOST from .env)
 *   <SERVICE_NAME>-refresh  NSAA scrape: runs once at start, then hourly via cron_restart
 *
 * Only SERVICE_NAME is read here. Everything else stays in .env and is loaded by the scripts when they start, so
 * `pm2 restart <name>` after editing .env picks the change up — values passed through PM2's env would be frozen
 * into its saved process list and win over .env.
 */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

let envFile = "";
try {
  envFile = readFileSync(join(__dirname, ".env"), "utf8");
} catch {}
const name = /^SERVICE_NAME=(.+)$/m.exec(envFile)?.[1].trim() || "volleyball";

module.exports = {
  apps: [
    {
      name,
      cwd: __dirname,
      script: "scripts/start.mjs",
      env: { NODE_ENV: "production" },
      time: true,
      restart_delay: 5000,
      kill_timeout: 10000,
    },
    {
      name: `${name}-refresh`,
      cwd: __dirname,
      script: "scripts/refresh.mjs",
      env: { NODE_ENV: "production" },
      time: true,
      autorestart: false,
      cron_restart: "0 * * * *",
    },
  ],
};
