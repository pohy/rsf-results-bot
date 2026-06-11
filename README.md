# rsf-results-bot

A Discord bot that watches rallies on [RallySimFans](https://www.rallysimfans.hu)
(the Richard Burns Rally online community) and posts new stage-result comments to
Discord as they appear.

You tell the bot which rallies to follow via slash commands. A separate scraper
periodically logs into RallySimFans, walks each watched rally's stage results,
and posts any newly-found comments to the channel you bound the rally to.

## How it works

The system is two decoupled processes that share only the database:

- **Bot** (`src/bot.ts`) — an always-on Discord gateway client. It handles
  `/watch` slash commands and only reads/writes the `watched_rally` table. It
  never scrapes or posts results.
- **Cron scraper** (`src/cron.ts`) — periodically re-reads the watch list (so bot
  changes take effect without a restart) and scrapes each watched rally **one at
  a time**, with delays between stages and between rallies so it never hammers
  the site. New comments are batched into Discord messages, routed per channel.

New comments are written to the DB undelivered and only marked delivered after a
successful Discord post, so a failed post is retried on the next pass. A rally
stops being polled once its deadline has passed and a full scrape ran afterward
(the field is then complete).

## Slash commands

```
/watch add    url:<rally URL> channel:<#channel> [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch edit   rally:<id> [channel:<#channel>] [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch remove rally:<id>
/watch list
```

- `add` takes a rally **URL** (any `rallysimfans.hu` rally page); the `rally_id`
  is parsed out and the rally name is resolved from its public details page.
- `channel` picks where that rally's comments post.
- `send_old_comments` (default off) posts the pre-existing comment backlog on the
  first scrape instead of suppressing it.
- `include_rally_title` — `Off` / `On` / `Contextual` (show the title only when
  the channel's last posted title differs).
- All commands are restricted to an allowlist of Discord user ids.

## Stack

- [Bun](https://bun.sh) runtime + TypeScript
- [discord.js](https://discord.js.org) — gateway bot, slash commands
- [Kysely](https://kysely.dev) — typed SQL, SQLite (dev) / Postgres (prod)
- [cheerio](https://cheerio.js.org) — HTML parsing of result pages
- [Zod](https://zod.dev) — env and input validation
- [Biome](https://biomejs.dev) — lint + format

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   ```

   - `RSF_USER` / `RSF_PASS` / `RSF_USER_ID` — RallySimFans login (the scraper
     needs a session to read stage results).
   - `DISCORD_*` — Discord bot setup. See [`docs/discord.md`](docs/discord.md).
   - `DATABASE_URL` — set for Postgres in prod; leave empty to use local SQLite
     (`SQLITE_PATH` or `./data/dev.sqlite`).

3. Run migrations:

   ```bash
   bun run migrate
   ```

## Running

```bash
bun run bot     # Discord gateway bot (slash commands)
bun run cron    # scraper pass; set CRON_SCHEDULE to self-schedule, else one pass and exit
bun run results # one-off scrape of a single rally id (probe/debug)
```

When `CRON_SCHEDULE` is unset the scraper runs one pass and exits — drive it from
system cron. Set a cron expression to self-schedule in-process (UTC). Throttling
is tunable via `CRON_STAGE_DELAY_MS` / `CRON_RALLY_DELAY_MS`.

### Docker

A `Dockerfile` and `docker-compose.yml` are included for running the bot and
scraper against Postgres.

## Development

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # biome lint
bun run check       # biome check --write
```

## Docs

- [`docs/auth.md`](docs/auth.md) — RallySimFans login/session handling
- [`docs/discord.md`](docs/discord.md) — Discord bot setup and command design
- [`docs/stage-results.md`](docs/stage-results.md) — result-page scraping notes
```
