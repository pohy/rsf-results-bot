import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { RallyKey, StageEntry, StageRow } from "./results.js";

// A comment seen for the first time this run. The cron batches these into one
// Discord post; the count alone (caller does `.length`) covers probe's needs.
export interface NewComment {
  stageNo: number;
  nickname: string;
  comment: string;
}

export interface PersistResult {
  // Rows inserted this run (not previously stored) that carry a non-null comment.
  newComments: NewComment[];
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
            // Undelivered until a Discord post succeeds; the cron stamps this
            // via markDelivered. See selectUndelivered / the 0004 migration.
            delivered_at: null,
          })),
        )
        .onConflict((oc) => oc.columns(["rally_id", "stage_no", "user_id"]).doNothing())
        .execute();
    }

    const newComments: NewComment[] = fresh
      .filter((row): row is StageRow & { comment: string } => row.comment !== null)
      .map((row) => ({ stageNo, nickname: row.nickname, comment: row.comment }));
    return { newComments };
  });
}

// An undelivered comment with everything needed to render it and, once posted,
// stamp the source row as delivered. rallyName comes from watched_rally; it
// falls back to the id if the rally was unwatched while a comment was still
// pending, so an orphaned comment still posts with usable context.
export interface UndeliveredComment {
  rallyId: number;
  stageNo: number;
  userId: number;
  rallyName: string;
  // Scraped stage name (e.g. "Granbacken", "Power Stage Ouninpohja"), or null
  // if the stage row predates title scraping; the renderer falls back to S<no>.
  stageTitle: string | null;
  nickname: string;
  comment: string;
}

// Every comment row not yet posted to Discord, oldest first. Picks up rows left
// behind by earlier failed posts, not just this pass's inserts — that's the
// whole point of delivered_at. Rows without a comment are skipped.
export async function selectUndelivered(db: Kysely<Database>): Promise<UndeliveredComment[]> {
  const rows = await db
    .selectFrom("result")
    .leftJoin("watched_rally", "watched_rally.rally_id", "result.rally_id")
    .leftJoin("stage", (join) =>
      join
        .onRef("stage.rally_id", "=", "result.rally_id")
        .onRef("stage.stage_no", "=", "result.stage_no"),
    )
    .select([
      "result.rally_id as rallyId",
      "result.stage_no as stageNo",
      "result.user_id as userId",
      "watched_rally.name as rallyName",
      "stage.title as stageTitle",
      "result.nickname as nickname",
      "result.comment as comment",
    ])
    .where("result.comment", "is not", null)
    .where("result.delivered_at", "is", null)
    .orderBy("result.first_seen_at", "asc")
    .execute();

  return rows.map((r) => ({
    rallyId: r.rallyId,
    stageNo: r.stageNo,
    userId: r.userId,
    rallyName: r.rallyName ?? `Rally ${r.rallyId}`,
    stageTitle: r.stageTitle,
    nickname: r.nickname,
    // comment is non-null by the WHERE above; the column type is still nullable.
    comment: r.comment as string,
  }));
}

// Stamp delivered_at on the given comment rows after a successful post, so they
// aren't collected again. Keyed by the result primary key. A no-op for an empty
// list. One transaction so a partial stamp can't split a posted batch.
export async function markDelivered(
  db: Kysely<Database>,
  rows: Array<Pick<UndeliveredComment, "rallyId" | "stageNo" | "userId">>,
  now: number,
): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction().execute(async (trx) => {
    for (const r of rows) {
      await trx
        .updateTable("result")
        .set({ delivered_at: now })
        .where("rally_id", "=", r.rallyId)
        .where("stage_no", "=", r.stageNo)
        .where("user_id", "=", r.userId)
        .execute();
    }
  });
}
