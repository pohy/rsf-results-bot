import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, type MigrationResultSet, Migrator } from "kysely/migration";
import { backendDescription, makeDb } from "./db/index.js";
import { loadDbEnv } from "./env.js";
import { makeLogger } from "./logger.js";

const logger = makeLogger("migrate");

// Migration runner. `bun run src/migrate.ts` applies all pending migrations;
// `bun run src/migrate.ts down` reverts the last one. Uses makeDb() so it
// targets sqlite locally and Postgres when DATABASE_URL is set — same dialect
// selection as the app. Run by Bun directly so `bun:sqlite` resolves natively.
async function main() {
  const env = loadDbEnv();
  const migrationFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  const db = makeDb(env);
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // Anchor to this file (src/), not cwd, so migrate works from any directory.
      migrationFolder,
    }),
  });

  const down = process.argv[2] === "down";
  logger.log(`migrating ${backendDescription(env)} (${down ? "down" : "latest"})`);

  const { error, results }: MigrationResultSet = down
    ? await migrator.migrateDown()
    : await migrator.migrateToLatest();

  for (const r of results ?? []) {
    logger.log(`${r.status}: ${r.migrationName} (${r.direction})`);
  }
  if (!error && (results?.length ?? 0) === 0) {
    logger.log("already up to date — no pending migrations");
  }

  await db.destroy();
  if (error) {
    logger.error("migration failed:", error);
    process.exit(1);
  }
}

main();
