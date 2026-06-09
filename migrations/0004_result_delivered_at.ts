import { type Kysely, sql } from "kysely";

// Track Discord delivery per result row. The cron persists scraped rows as it
// goes, then posts new comments in one message at the end of a pass. Persisting
// and posting were coupled: a row was treated as "seen" the moment it was
// written, so if the Discord post failed (rate limit, missing permission, etc.)
// the comment was committed but never delivered — and never re-collected,
// because the next pass only looked at brand-new rows. Comments were lost.
//
// delivered_at decouples the two: a comment row is undelivered until a post
// succeeds. Each pass collects every undelivered comment (including ones left
// over from earlier failed posts) and only stamps delivered_at after the post
// goes through. Nullable "bigint" epoch-ms, matching the other timestamps
// (see 0001_init.ts). Rows that never carry a comment stay null forever and are
// simply ignored by the undelivered query.
//
// Index on delivered_at so the per-pass "find undelivered" scan stays cheap as
// the result table grows.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("result").addColumn("delivered_at", "bigint").execute();

  // Backfill existing rows as already delivered. They predate this feature, so
  // they were either posted or are part of the lost backlog we can't recover —
  // either way we must not re-post the entire comment history on the first pass
  // after deploy. Stamp first_seen_at so the value is a sensible timestamp.
  await sql`update "result" set "delivered_at" = "first_seen_at" where "delivered_at" is null`.execute(
    db,
  );

  await db.schema
    .createIndex("result_delivered_at_idx")
    .on("result")
    .column("delivered_at")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("result_delivered_at_idx").execute();
  await db.schema.alterTable("result").dropColumn("delivered_at").execute();
}
