/**
 * Production entry point: `next start` on PORT/HOST from .env.
 *
 * Next.js can't read PORT from .env itself (the HTTP server boots before env files load), so this loads them the
 * same way Next does and passes the port through. Used by `npm start` and the systemd unit.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const port = process.env.PORT || "3000";
const host = process.env.HOST || "127.0.0.1";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", host], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
