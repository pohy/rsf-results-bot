import type { Kysely } from "kysely";

// Per-rally control over the comment backlog. When a rally is added it usually
// already has a full history of comments; posting all of them to Discord on the
// first scrape floods the channel. send_old_comments lets the adder opt out of
// that backlog while still getting comments that appear afterwards.
//
// Two columns, both stored as integer 0/1 to match the codebase's no-boolean
// convention (identical on sqlite INTEGER affinity and pg int4, no dialect
// drift — see 0001_init.ts / schema.ts):
//
//   send_old_comments — config set by /watch add. 1 = post the existing
//     backlog (previous behavior); 0 = suppress it.
//   backfilled — state. 0 until the cron's first full scrape of the rally has
//     completed; 1 afterwards. The first scrape is the one that turns up the
//     backlog, so the suppression decision only applies there. Time alone can't
//     tell a backlog comment from a genuinely new one (both are first seen at
//     scrape time), so this explicit flag is needed.
//
// Defaults make existing rows behave as before: send_old_comments 1 (no change
// in delivery) and backfilled 1 (already past their first scrape, so the cron
// never tries to suppress anything for them).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("watched_rally")
    .addColumn("send_old_comments", "integer", (c) => c.notNull().defaultTo(1))
    .execute();
  await db.schema
    .alterTable("watched_rally")
    .addColumn("backfilled", "integer", (c) => c.notNull().defaultTo(1))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("watched_rally").dropColumn("backfilled").execute();
  await db.schema.alterTable("watched_rally").dropColumn("send_old_comments").execute();
}
