// Kysely table types. Timestamps are epoch-ms integers (see migrations for why:
// identical storage on sqlite INTEGER affinity and pg bigint, no dialect drift).
// All ms values stay < 2^53, so they round-trip as JS numbers on both drivers.

export interface StageTable {
  rally_id: number;
  stage_no: number;
  title: string | null;
  fetched_at: number;
}

export interface ResultTable {
  rally_id: number;
  stage_no: number;
  user_id: number;
  nickname: string;
  position: number;
  stage_time_ms: number | null;
  diff_prev_ms: number | null;
  diff_first_ms: number | null;
  comment: string | null;
  // MVP is insert-only: a (rally, stage, user) row is written once and
  // never updated, so this is the time it was first scraped. See persist.ts for
  // the deferred "track position/time history across re-scrapes" note.
  first_seen_at: number;
  // Epoch-ms the comment on this row was posted to Discord, or null if not yet
  // delivered. Rows without a comment stay null forever. The cron posts every
  // undelivered comment each pass and stamps this only after the post succeeds,
  // so a failed post is retried instead of silently dropped (see 0004 migration).
  delivered_at: number | null;
}

// Rallies the Discord bot watches. added_by is a Discord user id (a 64-bit
// snowflake), stored as text since it can exceed 2^53.
export interface WatchedRallyTable {
  rally_id: number;
  name: string;
  added_by: string;
  added_at: number;
  // Epoch-ms close time scraped from the rally list (Budapest-local). Null until
  // the cron first sees the rally on the list; a null deadline means "keep
  // polling" — the poller can't tell it's finished. See poll.ts / cron.ts.
  deadline_at: number | null;
  // 0/1 (no-boolean convention, see 0005 migration). send_old_comments: whether
  // the rally's pre-existing comment backlog is posted on the first scrape (1) or
  // suppressed (0). backfilled: 0 until that first full scrape completes, 1 after
  // — the suppression decision only applies to that first scrape (see cron.ts).
  send_old_comments: number;
  backfilled: number;
  // 0/1 (no-boolean convention, see 0007 migration). Whether the rally's Discord
  // posts include the **Rally name** header. Default 0: comments are split by
  // rally, so the title is redundant unless a channel hosts more than one rally.
  include_rally_title: number;
  // Discord channel id this rally's comments post to, set by /watch add. Text,
  // like added_by — channel ids are 64-bit snowflakes that exceed 2^53. NOT NULL:
  // /watch add requires it for new rows, and the 0006 migration backfills existing
  // rows to DISCORD_RESULTS_CHANNEL_ID (required at migration time).
  channel_id: string;
}

export interface Database {
  stage: StageTable;
  result: ResultTable;
  watched_rally: WatchedRallyTable;
}
