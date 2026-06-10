import type { Kysely } from "kysely";

// Per-rally Discord channel routing. Until now the cron posted every rally's
// comments to one fixed channel (DISCORD_RESULTS_CHANNEL_ID); channel_id lets
// each watched rally target its own channel, chosen at /watch add time. Text,
// like added_by — channel ids are 64-bit snowflakes that exceed 2^53.
//
// NOT NULL, added with a DEFAULT so it can land on a populated table in one
// statement on both dialects (same trick as 0005's send_old_comments). The
// default backfills existing rows to DISCORD_RESULTS_CHANNEL_ID — the channel
// they were already posting to — so delivery is unchanged for already-watched
// rallies; new rows always provide channel_id (/watch add requires it, and the
// kysely insert types it non-optional), so the default is inert thereafter.
//
// The env var is required to migrate: without it there's no correct value to
// backfill existing rows to, and a guessed one would silently misroute a live
// rally. Fail loudly instead.

export async function up(db: Kysely<unknown>): Promise<void> {
  const fallback = process.env.DISCORD_RESULTS_CHANNEL_ID;
  if (!fallback) {
    throw new Error(
      "DISCORD_RESULTS_CHANNEL_ID must be set to run this migration: it backfills " +
        "channel_id on existing watched_rally rows (the channel they already posted to).",
    );
  }
  await db.schema
    .alterTable("watched_rally")
    .addColumn("channel_id", "text", (c) => c.notNull().defaultTo(fallback))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("watched_rally").dropColumn("channel_id").execute();
}
