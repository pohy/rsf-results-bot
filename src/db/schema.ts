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
}

export interface Database {
  stage: StageTable;
  result: ResultTable;
}
