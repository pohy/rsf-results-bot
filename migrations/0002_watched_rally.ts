import type { Kysely } from "kysely";

// The set of rallies the Discord bot watches. Written only by the bot's /watch
// commands; read by whatever scrapes/posts (decoupled, out of this table's
// concern). Car group is intentionally absent — a rally is watched as a whole.
//
// Column types follow 0001_init.ts: "integer" for site ids, "bigint" for
// epoch-ms, "text" for strings — identical on sqlite and Postgres. added_by is
// "text" because Discord user ids are 64-bit snowflakes that exceed 2^53.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("watched_rally")
    .addColumn("rally_id", "integer", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("added_by", "text", (c) => c.notNull())
    .addColumn("added_at", "bigint", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("watched_rally").execute();
}
