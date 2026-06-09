import { Database as BunDatabase } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DbEnv } from "../env.js";
import { BunSqliteDialect } from "./bun-sqlite-dialect.js";
import type { Database } from "./schema.js";

// pg returns int8 (bigint) as a string to avoid precision loss. Our epoch-ms
// timestamps stay < 2^53, so parse OID 20 back to a JS number to match the
// sqlite driver and the `number` column types in schema.ts. OID 20 = int8.
pg.types.setTypeParser(20, (v) => Number(v));

export function makeSqliteDialect(path: string): BunSqliteDialect {
  // bun:sqlite creates the file but not parent dirs; ensure they exist.
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new BunDatabase(path);
  // FKs are off per-connection in sqlite; enable to match pg enforcement.
  // Default (rollback journal) keeps everything in the single .sqlite file —
  // immediately visible to viewers and simple to back up. The scraper is the
  // only writer, so WAL's concurrency edge isn't worth the -wal/-shm footprint.
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return new BunSqliteDialect(sqlite);
}

export function makePostgresDialect(connectionString: string): PostgresDialect {
  return new PostgresDialect({ pool: new pg.Pool({ connectionString }) });
}

// DATABASE_URL present => Postgres (prod). Otherwise sqlite file (local dev),
// SQLITE_PATH or its default.
export function dialectFromEnv(env: DbEnv) {
  if (env.DATABASE_URL) return makePostgresDialect(env.DATABASE_URL);
  return makeSqliteDialect(env.SQLITE_PATH);
}

// Human-readable description of the active backend, secrets stripped. Log this
// so a missing DATABASE_URL (silent fallback to local sqlite) is visible rather
// than silently sending prod writes to a throwaway file.
export function backendDescription(env: DbEnv): string {
  if (!env.DATABASE_URL) return `sqlite ${env.SQLITE_PATH}`;
  // DATABASE_URL is validated as a URL by the env schema, so parsing won't throw.
  const u = new URL(env.DATABASE_URL);
  return `postgres ${u.host}${u.pathname}`;
}

export function makeDb(env: DbEnv): Kysely<Database> {
  return new Kysely<Database>({ dialect: dialectFromEnv(env) });
}
