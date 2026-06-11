import { type Kysely, sql } from "kysely";

// Make result.position nullable. Super Rally ("SR") rows — a driver who
// restarted — have no finishing position; the site prints "SR" in the position
// cell. The scraper now keeps these rows (they carry comments) with a null
// position instead of dropping them (see parsePosition / StageRowSchema in
// results.ts).
//
// Dialect split mirrors dialectFromEnv (db/index.ts): DATABASE_URL present =>
// Postgres, otherwise sqlite. Postgres alters the column in place; sqlite has no
// ALTER COLUMN to drop NOT NULL, so the table is rebuilt (the standard recipe).
const isPostgres = (): boolean => !!process.env.DATABASE_URL;

// Recreate the `result` table from scratch with `position` carrying the given
// nullability, copying all rows over. Used for both up (nullable) and down
// (notNull) on sqlite. Column list and constraints mirror 0001_init.ts +
// 0004 (delivered_at). The delivered_at index is dropped first and recreated
// after the rename — index names are global in sqlite.
async function rebuildResult(db: Kysely<unknown>, positionNotNull: boolean): Promise<void> {
  await db.schema.dropIndex("result_delivered_at_idx").execute();

  await db.schema
    .createTable("result_new")
    .addColumn("rally_id", "integer", (c) => c.notNull())
    .addColumn("stage_no", "integer", (c) => c.notNull())
    .addColumn("user_id", "integer", (c) => c.notNull())
    .addColumn("nickname", "text", (c) => c.notNull())
    .addColumn("position", "integer", (c) => (positionNotNull ? c.notNull() : c))
    .addColumn("stage_time_ms", "bigint")
    .addColumn("diff_prev_ms", "bigint")
    .addColumn("diff_first_ms", "bigint")
    .addColumn("comment", "text")
    .addColumn("first_seen_at", "bigint", (c) => c.notNull())
    .addColumn("delivered_at", "bigint")
    .addPrimaryKeyConstraint("result_pk", ["rally_id", "stage_no", "user_id"])
    .addForeignKeyConstraint(
      "result_stage_fk",
      ["rally_id", "stage_no"],
      "stage",
      ["rally_id", "stage_no"],
      (c) => c.onDelete("cascade"),
    )
    .execute();

  await sql`insert into "result_new" (
      "rally_id", "stage_no", "user_id", "nickname", "position",
      "stage_time_ms", "diff_prev_ms", "diff_first_ms", "comment",
      "first_seen_at", "delivered_at"
    ) select
      "rally_id", "stage_no", "user_id", "nickname", "position",
      "stage_time_ms", "diff_prev_ms", "diff_first_ms", "comment",
      "first_seen_at", "delivered_at"
    from "result"`.execute(db);

  await db.schema.dropTable("result").execute();
  await sql`alter table "result_new" rename to "result"`.execute(db);

  await db.schema
    .createIndex("result_delivered_at_idx")
    .on("result")
    .column("delivered_at")
    .execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (isPostgres()) {
    await db.schema
      .alterTable("result")
      .alterColumn("position", (c) => c.dropNotNull())
      .execute();
    return;
  }
  await rebuildResult(db, false);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverting fails if any SR rows (null position) exist — there's no valid
  // integer to backfill. Drop those rows first if a down migration is needed.
  if (isPostgres()) {
    await db.schema
      .alterTable("result")
      .alterColumn("position", (c) => c.setNotNull())
      .execute();
    return;
  }
  await rebuildResult(db, true);
}
