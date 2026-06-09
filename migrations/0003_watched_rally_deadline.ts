import type { Kysely } from "kysely";

// Add the rally close time to watched_rally so the cron can stop polling rallies
// that have finished. Nullable: the cron fills it in from the rally list each
// pass, and a null deadline means "not yet known, keep polling". "bigint" for
// epoch-ms, matching the other timestamps (see 0001_init.ts).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("watched_rally").addColumn("deadline_at", "bigint").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("watched_rally").dropColumn("deadline_at").execute();
}
