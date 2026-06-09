import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";

// Queries over the watched_rally table. The Discord bot is the only writer.

export interface WatchedRally {
  rallyId: number;
  name: string;
}

export interface AddWatched {
  rallyId: number;
  name: string;
  addedBy: string;
  addedAt: number;
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
      })
      .execute();
    return true;
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
    .select(["rally_id", "name"])
    .orderBy("added_at", "asc")
    .execute();
  return rows.map((r) => ({ rallyId: r.rally_id, name: r.name }));
}
