import type { Kysely } from "kysely";

// Column types chosen to compile identically on sqlite and Postgres:
//   "integer" -> pg int4 / sqlite INTEGER affinity
//   "bigint"  -> pg int8 / sqlite INTEGER affinity (name contains "int")
//   "text"    -> both
// Epoch-ms timestamps use "bigint" so they fit on Postgres too.
//
// MVP is insert-only (see persist.ts): rows are written once, never updated, so
// there's no updated_at and no posted-state column. Tracking how position/times
// change across re-scrapes (append-only history / versioned rows) is deferred.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("stage")
    .addColumn("rally_id", "integer", (c) => c.notNull())
    .addColumn("stage_no", "integer", (c) => c.notNull())
    .addColumn("title", "text")
    .addColumn("fetched_at", "bigint", (c) => c.notNull())
    .addPrimaryKeyConstraint("stage_pk", ["rally_id", "stage_no"])
    .execute();

  await db.schema
    .createTable("result")
    .addColumn("rally_id", "integer", (c) => c.notNull())
    .addColumn("stage_no", "integer", (c) => c.notNull())
    .addColumn("user_id", "integer", (c) => c.notNull())
    .addColumn("nickname", "text", (c) => c.notNull())
    .addColumn("position", "integer", (c) => c.notNull())
    .addColumn("stage_time_ms", "bigint")
    .addColumn("diff_prev_ms", "bigint")
    .addColumn("diff_first_ms", "bigint")
    .addColumn("comment", "text")
    .addColumn("first_seen_at", "bigint", (c) => c.notNull())
    .addPrimaryKeyConstraint("result_pk", ["rally_id", "stage_no", "user_id"])
    .addForeignKeyConstraint(
      "result_stage_fk",
      ["rally_id", "stage_no"],
      "stage",
      ["rally_id", "stage_no"],
      (c) => c.onDelete("cascade"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("result").execute();
  await db.schema.dropTable("stage").execute();
}
