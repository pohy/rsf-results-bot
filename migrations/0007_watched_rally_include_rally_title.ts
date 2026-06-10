import type { Kysely } from "kysely";

// Per-rally control over whether the rally title appears in its Discord posts.
// Comments are split by rally (one rally never shares a message with another),
// so the **Rally name** header is redundant when a channel hosts a single rally.
// include_rally_title lets the adder opt back into it for shared channels.
//
// Integer 0/1, matching the codebase's no-boolean convention (see 0005). Default
// 0 so existing rows omit the title (the new default), and the column lands on a
// populated table in one statement on both dialects.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("watched_rally")
    .addColumn("include_rally_title", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("watched_rally").dropColumn("include_rally_title").execute();
}
