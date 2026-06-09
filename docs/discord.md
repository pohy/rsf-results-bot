# Discord Integration

Implemented in `src/bot.ts` (gateway client + commands), `src/watched.ts`
(`watched_rally` queries), `src/results.ts` (`rallyIdFromUrl`, `parseRallyName`,
`fetchRallyName`), and migration `0002_watched_rally.ts`. Run with
`bun run bot` after `bun run migrate`.

A single Discord **gateway bot** owns all Discord interaction. Users manage the
watched-rally list by issuing slash commands; the bot writes those into the
database. Scraping and posting results are a **separate, fully decoupled**
concern — not built here and not touched by this bot.

One thing to set up in Discord: the bot application + its token.

## Why a gateway bot (not a webhook)

A webhook is send-only — it cannot receive commands. Managing the watch list
requires receiving user input, so the bot must hold a gateway connection and run
as an always-on process. We use **one** bot for everything rather than a webhook
for output plus a bot for input.

## Decoupling

This bot only reads and writes the `watched_rally` table. It never scrapes
results, never posts results, and shares nothing with the cron/CLI scraper
except that one table. Whatever later reads `watched_rally` to scrape and post is
out of scope here.

## Command interface — slash commands

Slash commands are typed, give autocomplete, and need **no privileged intent**
(only the default `Guilds` intent).

```
/watch add  url:<rally URL>
/watch remove rally:<id>
/watch list
```

- `add` takes the **rally URL**, not raw ids. Car group plays no role here and
  is not stored. Adding an already-watched rally is rejected (see below).
- `remove` takes the rally id (shown by `list`).
- `list` replies ephemerally (only the caller sees it) and shows just
  `rally_id` + `name` — not `added_by` / `added_at`.

### Parsing the rally URL

The bot extracts `rally_id` from the URL's query string. Both of these forms
(and any other `centerbox`) yield `99383`:

```
https://www.rallysimfans.hu/rbr/rally_online.php?centerbox=rally_results.php&rally_id=99383&cg=7
https://www.rallysimfans.hu/rbr/rally_online.php?centerbox=rally_list_details.php&rally_id=99383
```

Parse with `URL` + `searchParams.get("rally_id")`; reject if absent or not a
positive integer. The `cg` param, if present, is ignored.

### Resolving the name (rally name)

`name` is the rally's name, parsed from its **public** details page (no login
required — verified against `rally_list_details.php`):

```
GET https://www.rallysimfans.hu/rbr/rally_online.php?centerbox=rally_list_details.php&rally_id=<id>
```

The name sits in the "Rally info" header table:

```html
<div class="fejlec4">Rally info</div>
<table ...><tr class="fejlec"><td colspan="3"><b>TTR FastFood 6 Round1</td>...
```

Selector: the `div.fejlec4` whose text is `Rally info`, then its following
`table` → `tr.fejlec td b` (first). Reuse `readHtml` + the `BASE`/UA from
`src/client.ts` and `cheerio` (already a dependency). A new pure parser
`parseRallyName(html): string | null` belongs alongside the other parsers in
`src/results.ts`. This fetch is a one-shot metadata lookup, not the results
scrape — the decoupling holds.

If the page 404s or the name can't be parsed, `add` fails with an ephemeral error
and writes nothing.

## Authorization — gate all commands

Every command is restricted to an allowlist of Discord user ids, configured via
env. Non-allowed callers get an ephemeral "not authorized" reply and no action
runs. Checked in code on each interaction (not relying on Discord's per-command
permission UI), so the gate is explicit and visible.

`DISCORD_ALLOWED_USER_IDS` — comma-separated Discord user ids. These are 64-bit
snowflakes; compare as **strings**, never parse to number.

## Schema — `watched_rally` (migration 0002)

Mirrors `migrations/0001_init.ts` conventions: `integer` for RSF ids, `bigint`
for epoch-ms, dual-dialect safe. No car group column (dropped from the model).

| Column     | Type    | Notes                                                            |
| ---------- | ------- | ---------------------------------------------------------------- |
| `rally_id` | integer | primary key                                                      |
| `name`     | text    | rally name parsed on add; shown by `/watch list`                 |
| `added_by` | text    | Discord user id — a 64-bit snowflake, store as **text** (> 2^53) |
| `added_at` | bigint  | epoch-ms                                                         |

PK `(rally_id)`. Add `WatchedRallyTable` to `src/db/schema.ts` and
`watched_rally` to the `Database` interface.

- `add` inserts **only if not already present**. The `rally_id` PK makes this
  safe under concurrency: insert with `onConflict(...).doNothing()` and check
  whether a row was actually inserted (`insertedRows === 0n` → duplicate). On
  duplicate, reply with an ephemeral error naming the existing rally ("already
  watching: <name>") and write nothing. No upsert — re-adding never silently
  overwrites.
- `remove` deletes by `rally_id`.
- `list` selects `rally_id` + `name` ordered by `added_at`.

## Setup (outside the codebase)

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token**, copy → `.env` as `DISCORD_BOT_TOKEN` (secret).
   Leave all **Privileged Gateway Intents** OFF.
3. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`. Open the
   generated URL to invite the bot to the server.
4. Copy the **Application ID** → `DISCORD_APP_ID`, and the target server id →
   `DISCORD_GUILD_ID`. Guild-scoped slash-command registration updates instantly;
   global registration takes ~1h to propagate. Commands are registered **on bot
startup** (idempotent guild-scoped `PUT`) — single guild, rare restarts, so no
drift and no separate step. A one-shot register script is only worth it if this
ever goes global.
5. Get the allowed users' ids (Discord → Developer Mode → right-click user → Copy
   User ID) → `DISCORD_ALLOWED_USER_IDS`.

## Environment

| Variable                   | Required | Purpose                                          |
| -------------------------- | -------- | ------------------------------------------------ |
| `DISCORD_BOT_TOKEN`        | yes      | Gateway bot auth. Secret.                        |
| `DISCORD_APP_ID`           | yes      | Application id, for slash-command registration.  |
| `DISCORD_GUILD_ID`         | yes      | Register commands to this guild (instant).       |
| `DISCORD_ALLOWED_USER_IDS` | yes      | Comma-separated user ids allowed to run commands |

## Open decisions

None outstanding.
