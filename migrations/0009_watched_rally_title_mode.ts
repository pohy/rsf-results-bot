import { type Kysely, sql } from "kysely";

// Two related changes that enable "contextual" rally titles:
//
//   1. start_at — epoch-ms open time scraped from the rally list (Budapest-local,
//      the cell's first segment; close time is deadline_at). Nullable like
//      deadline_at: null until the cron first sees the rally on the list. It bounds
//      how far back the contextual title scan reads a channel's history — no driver
//      comment, and thus no rally header, can predate the rally opening, so the
//      scan stops once it passes start_at (see cron.ts fetchLastRallyTitle).
//
//   2. rally_title_mode — replaces the 0/1 include_rally_title flag with a
//      three-way text enum: 'off' (never show the **Rally name** header), 'on'
//      (always), 'contextual' (only when the channel's last posted rally header
//      isn't this rally). 'contextual' is the new default. Existing rows migrate
//      by value: include_rally_title = 1 maps to 'on'; everything else takes the
//      new default 'contextual' (the old default-off rows had no way to express
//      an explicit choice, so they adopt the smart default). Stored as text so
//      the column reads as the choice it represents, not an int code.

export async function up(db: Kysely<unknown>): Promise<void> {
  // bigint for the same reason as deadline_at: identical epoch-ms storage on
  // sqlite INTEGER affinity and pg int8, and the value stays < 2^53.
  await db.schema.alterTable("watched_rally").addColumn("start_at", "bigint").execute();

  // NOT NULL with a default so it lands on a populated table in one statement on
  // both dialects (same trick as 0005/0006). The default fills every existing row
  // with 'contextual'; the next statement then reclaims the old 'on' rows.
  await db.schema
    .alterTable("watched_rally")
    .addColumn("rally_title_mode", "text", (c) => c.notNull().defaultTo("contextual"))
    .execute();

  // Carry the old flag's meaning over before dropping it: 1 -> 'on'. Rows with 0
  // keep the column default 'contextual' applied above.
  await sql`update watched_rally set rally_title_mode = 'on' where include_rally_title = 1`.execute(
    db,
  );

  await db.schema.alterTable("watched_rally").dropColumn("include_rally_title").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("watched_rally")
    .addColumn("include_rally_title", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  // Reverse the value mapping: 'on' was the only mode that showed the title
  // unconditionally; 'contextual' has no 0/1 equivalent, so it folds to 0.
  await sql`update watched_rally set include_rally_title = 1 where rally_title_mode = 'on'`.execute(
    db,
  );

  await db.schema.alterTable("watched_rally").dropColumn("rally_title_mode").execute();
  await db.schema.alterTable("watched_rally").dropColumn("start_at").execute();
}
