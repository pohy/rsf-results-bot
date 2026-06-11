import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { RallyKey, StageEntry, StageRow } from "./results.js";
import type { RallyTitleMode } from "./watched.js";

// A comment seen for the first time this run. The cron batches these into one
// Discord post; the count alone (caller does `.length`) covers probe's needs.
export interface NewComment {
  stageNo: number;
  nickname: string;
  comment: string;
}

export interface PersistResult {
  // Comments to deliver this run: rows inserted with a non-null comment, plus
  // already-stored rows whose comment first appeared or changed since last scrape.
  newComments: NewComment[];
}

// The stage results page renders each driver in two tables: the left table
// (per-stage times) carries the Tip() comment, the right table (overall
// standings) does not. parseRows scrapes both, so a driver appears twice with
// the same userId. Collapse to one row per user, keeping the comment-bearing
// (left) row when present so the right table's null doesn't shadow a comment.
function dedupeByUser(rows: StageRow[]): StageRow[] {
  const byUser = rows.reduce((acc, row) => {
    const kept = acc.get(row.userId);
    if (!kept || (kept.comment === null && row.comment !== null)) { acc.set(row.userId, row); }
    return acc;
  }, new Map<number, StageRow>());
  return [...byUser.values()];
}

// Comment-aware persistence. A (rally, stage, user) row is inserted the first
// time it's scraped. On re-scrape, an existing row's comment is updated when the
// scraped value first appears or differs from what's stored — drivers often add
// or edit a comment after their result row already exists — and that row is
// re-queued for delivery (delivered_at reset to null). Position/time are still
// first-write-wins; history of those changes remains out of scope.
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
      .select(["user_id", "comment"])
      .where("rally_id", "=", rallyId)
      .where("stage_no", "=", stageNo)
      .execute();
    const storedComment = new Map(existing.map((r) => [r.user_id, r.comment]));

    const rows = dedupeByUser(entry.rows);
    const fresh = rows.filter((row) => !storedComment.has(row.userId));
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

    // Stored rows whose scraped comment first appeared or changed. A scraped
    // null is ignored (don't erase a stored comment if a later scrape misses it).
    const changed = rows.filter(
      (row) =>
        storedComment.has(row.userId) &&
        row.comment !== null &&
        row.comment !== storedComment.get(row.userId),
    );
    for (const row of changed) {
      await trx
        .updateTable("result")
        .set({ comment: row.comment, delivered_at: null })
        .where("rally_id", "=", rallyId)
        .where("stage_no", "=", stageNo)
        .where("user_id", "=", row.userId)
        .execute();
    }

    const newComments: NewComment[] = [...fresh, ...changed]
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
  // Finishing position, or null for a Super Rally restart (the site prints "SR"
  // in the position cell — see results.ts). The renderer prefixes SR comments
  // with "(SR)", so null is the SR signal rather than a stored flag.
  position: number | null;
  // How the rendered message treats the **Rally name** header, from watched_rally.
  // 'off' for orphaned comments (rally unwatched; no joined row) — no title.
  rallyTitleMode: RallyTitleMode;
  // Epoch-ms rally open time, from watched_rally; bounds the contextual title
  // scan's walk through channel history. Null when unknown or orphaned.
  startAt: number | null;
  // Discord channel to post into, from watched_rally. Null when the rally was
  // unwatched while a comment was still pending (the leftJoin yields no row); the
  // cron routes those to the env fallback channel (see cron.ts runAndPost).
  channelId: string | null;
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
      "watched_rally.channel_id as channelId",
      "watched_rally.rally_title_mode as rallyTitleMode",
      "watched_rally.start_at as startAt",
      "stage.title as stageTitle",
      "result.nickname as nickname",
      "result.comment as comment",
      "result.position as position",
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
    channelId: r.channelId,
    // 'off' for orphaned comments (no watched_rally row) → omit the title.
    rallyTitleMode: r.rallyTitleMode ?? "off",
    startAt: r.startAt,
    stageTitle: r.stageTitle,
    nickname: r.nickname,
    // comment is non-null by the WHERE above; the column type is still nullable.
    comment: r.comment as string,
    position: r.position,
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
  if (rows.length === 0) { return; }
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
