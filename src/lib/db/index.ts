import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * node-postgres driver — works with a local Postgres or any hosted one (Neon included). `db` is null when
 * DATABASE_URL is unset so the app can run from the on-disk fixtures. The pool is kept on globalThis so dev-mode
 * hot reloads don't open a new pool per edit.
 */
export const hasDb = !!process.env.DATABASE_URL;

const g = globalThis as unknown as { __nsaaPool?: Pool };
// allowExitOnIdle: idle connections don't keep short-lived processes (next build workers, scripts) alive.
const pool = hasDb
  ? (g.__nsaaPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, allowExitOnIdle: true }))
  : null;

export const db = pool ? drizzle(pool, { schema }) : null;

export { schema };
