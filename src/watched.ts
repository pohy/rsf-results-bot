import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";

// Queries over the watched_rally table. The Discord bot is the only writer.

export interface WatchedRally {
  rallyId: number;
  name: string;
  channelId: string;
}

export interface AddWatched {
  rallyId: number;
  name: string;
  addedBy: string;
  addedAt: number;
  // Whether the rally's existing comment backlog is posted on the first scrape.
  // Stored as 0/1; backfilled starts at 0 so the cron's first pass applies this
  // choice (see completeBackfill / cron.ts).
  sendOldComments: boolean;
  // Discord channel id this rally's comments post to (required by /watch add).
  channelId: string;
}

// Insert a rally to watch. Returns false without writing when the rally is
// already watched (rally_id is the PK), so the caller can report a duplicate.
// The existence check and insert share a transaction; the PK is the final guard
// against a concurrent double-insert.
export async function addWatched(db: Kysely<Database>, w: AddWatched): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("watched_rally")
      .select("rally_id")
      .where("rally_id", "=", w.rallyId)
      .executeTakeFirst();
    if (existing) return false;
    await trx
      .insertInto("watched_rally")
      .values({
        rally_id: w.rallyId,
        name: w.name,
        added_by: w.addedBy,
        added_at: w.addedAt,
        send_old_comments: w.sendOldComments ? 1 : 0,
        // Not yet scraped; the cron's first pass runs the backlog decision.
        backfilled: 0,
        channel_id: w.channelId,
      })
      .execute();
    return true;
  });
}

// Close out a rally's first scrape: stamp backfilled = 1 so later passes treat
// its comments normally, and — when the rally opted out of its backlog
// (send_old_comments = 0) — mark every comment seen so far as delivered so the
// cron never posts them. Both writes share one transaction: a crash between them
// could otherwise leave backfilled = 0 with the backlog already suppressed, and
// the next pass would then suppress genuinely new comments too. Idempotent for
// already-backfilled rallies (caller only invokes it while backfilled = 0).
export async function completeBackfill(
  db: Kysely<Database>,
  rallyId: number,
  sendOldComments: boolean,
  now: number,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    if (!sendOldComments) {
      await trx
        .updateTable("result")
        .set({ delivered_at: now })
        .where("rally_id", "=", rallyId)
        .where("comment", "is not", null)
        .where("delivered_at", "is", null)
        .execute();
    }
    await trx
      .updateTable("watched_rally")
      .set({ backfilled: 1 })
      .where("rally_id", "=", rallyId)
      .execute();
  });
}

// Remove a watched rally. Returns false when nothing matched.
export async function removeWatched(db: Kysely<Database>, rallyId: number): Promise<boolean> {
  const res = await db
    .deleteFrom("watched_rally")
    .where("rally_id", "=", rallyId)
    .executeTakeFirst();
  return (res.numDeletedRows ?? 0n) > 0n;
}

// Refresh deadline_at for the given rallies (keyed by rally_id). Only rows that
// are actually watched are touched; ids not in watched_rally are ignored. Run
// per cron pass from the rally list so the poller's "finished" check stays
// current. Returns the number of watched rows updated.
export async function updateDeadlines(
  db: Kysely<Database>,
  deadlines: ReadonlyArray<{ rallyId: number; deadlineAt: number }>,
): Promise<number> {
  if (deadlines.length === 0) return 0;
  return db.transaction().execute(async (trx) => {
    let updated = 0;
    for (const d of deadlines) {
      const res = await trx
        .updateTable("watched_rally")
        .set({ deadline_at: d.deadlineAt })
        .where("rally_id", "=", d.rallyId)
        .executeTakeFirst();
      updated += Number(res.numUpdatedRows ?? 0n);
    }
    return updated;
  });
}

// All watched rallies, oldest first. Only the fields shown in /watch list.
export async function listWatched(db: Kysely<Database>): Promise<WatchedRally[]> {
  const rows = await db
    .selectFrom("watched_rally")
    .select(["rally_id", "name", "channel_id"])
    .orderBy("added_at", "asc")
    .execute();
  return rows.map((r) => ({ rallyId: r.rally_id, name: r.name, channelId: r.channel_id }));
}
