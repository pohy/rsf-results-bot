import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { RallyKey, StageEntry } from "./results.js";

export interface PersistResult {
  // Rows inserted this run (not previously stored) that carry a non-null comment.
  newComments: number;
}

// Insert-only persistence (MVP). A (rally, stage, user) row is written
// the first time it's scraped and never updated, so the first snapshot of
// position/time/comment wins and re-scrapes are no-ops for existing rows.
//
// DEFERRED: rally results change as a rally progresses (positions shift, faster
// times, edited comments). Capturing that history — append-only rows or a
// versioned table keyed by scrape time — is out of scope for the MVP. When added,
// `newComments` detection (currently "row is new") would shift to "value changed".
export async function persistStage(
  db: Kysely<Database>,
  rally: RallyKey,
  entry: StageEntry,
  now: number,
): Promise<PersistResult> {
  const { rallyId } = rally;
  const stageNo = entry.stageNo;

  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("stage")
      .values({
        rally_id: rallyId,
        stage_no: stageNo,
        title: entry.title,
        fetched_at: now,
      })
      .onConflict((oc) => oc.columns(["rally_id", "stage_no"]).doNothing())
      .execute();

    const existing = await trx
      .selectFrom("result")
      .select("user_id")
      .where("rally_id", "=", rallyId)
      .where("stage_no", "=", stageNo)
      .execute();
    const seen = new Set(existing.map((r) => r.user_id));

    const fresh = entry.rows.filter((row) => !seen.has(row.userId));
    if (fresh.length > 0) {
      await trx
        .insertInto("result")
        .values(
          fresh.map((row) => ({
            rally_id: rallyId,
            stage_no: stageNo,
            user_id: row.userId,
            nickname: row.nickname,
            position: row.position,
            stage_time_ms: row.stageTimeMs,
            diff_prev_ms: row.diffPrevMs,
            diff_first_ms: row.diffFirstMs,
            comment: row.comment,
            first_seen_at: now,
          })),
        )
        .onConflict((oc) => oc.columns(["rally_id", "stage_no", "user_id"]).doNothing())
        .execute();
    }

    const newComments = fresh.filter((row) => row.comment !== null).length;
    return { newComments };
  });
}
