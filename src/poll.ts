import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { WatchedRally } from "./watched.js";

// A pollable rally plus the per-rally backlog state the cron needs to apply the
// send_old_comments decision after the first scrape (see cron.ts / completeBackfill).
export interface PollableRally extends WatchedRally {
  sendOldComments: boolean;
  backfilled: boolean;
}

// A watched rally is "done" — and the cron stops polling it — once it has both:
//   1. finished: its deadline_at is known and now is past it, and
//   2. all comments parsed: at least one full scrape ran after the deadline
//      (a stage row whose fetched_at > deadline_at).
//
// Because the rally is closed by then, no new results or comments can appear, so
// that final post-deadline scrape captures the complete field. (Edge: a comment
// edited on an already-stored row *before* the deadline isn't re-captured — the
// documented insert-only MVP limitation in persist.ts, not addressed here.)
//
// A null deadline_at means "not known yet" and is never treated as done, so an
// unsynced rally keeps being polled rather than being skipped by mistake.
export async function selectPollable(db: Kysely<Database>, now: number): Promise<PollableRally[]> {
  const rows = await db
    .selectFrom("watched_rally as w")
    .select(["w.rally_id", "w.name", "w.channel_id", "w.send_old_comments", "w.backfilled"])
    .where((eb) =>
      eb.or([
        eb("w.deadline_at", "is", null),
        eb("w.deadline_at", ">=", now),
        eb.not(
          eb.exists(
            eb
              .selectFrom("stage as s")
              .select("s.rally_id")
              .whereRef("s.rally_id", "=", "w.rally_id")
              .whereRef("s.fetched_at", ">", "w.deadline_at"),
          ),
        ),
      ]),
    )
    .orderBy("w.added_at", "asc")
    .execute();
  return rows.map((r) => ({
    rallyId: r.rally_id,
    name: r.name,
    channelId: r.channel_id,
    sendOldComments: r.send_old_comments === 1,
    backfilled: r.backfilled === 1,
  }));
}
