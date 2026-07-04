# rsf-results-bot

Discord bot. Watch rallies on [RallySimFans](https://www.rallysimfans.hu). Post new stage-result comments to Discord as they appear.

Pick rallies with slash commands. Scraper logs in, walks stage results, posts new comments to bound channel.

## Two processes, share only DB

- **Bot** (`src/bot.ts`) — Discord gateway. Handles `/watch` commands. Only reads/writes `watched_rally`. Never scrapes.
- **Cron** (`src/cron.ts`) — re-reads watch list, scrapes each rally one at a time with delays (no hammering). Batches new comments per channel.

Comments stored undelivered, marked delivered only after successful post — failed post retried next pass.

## Commands

```
/watch add    url:<rally URL> channel:<#channel> [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch edit   rally:<id> [channel:<#channel>] [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch remove rally:<id>
/watch list   [status:<active|inactive|all>]
```

`add` takes rally URL, resolves name + id. `send_old_comments` (default off) posts backlog on first scrape. `include_rally_title` — `Off`/`On`/`Contextual`. `list` `status` (default `active`) filters by deadline: `active` (unknown or ahead), `inactive` (past), or `all`; long lists split across multiple messages. All commands gated to allowlist of Discord user ids.

## Stack

Bun + TypeScript · [discord.js](https://discord.js.org) · [Kysely](https://kysely.dev) (SQLite dev / Postgres prod) · [cheerio](https://cheerio.js.org) · [Zod](https://zod.dev) · [Biome](https://biomejs.dev)

## Setup

```bash
bun install
cp .env.example .env   # fill RSF_* login, DISCORD_*, DATABASE_URL
bun run migrate
```

Empty `DATABASE_URL` → local SQLite. Discord setup: [`docs/discord.md`](docs/discord.md).

## Run

```bash
bun run bot     # Discord gateway bot
bun run cron    # one scrape pass; set CRON_SCHEDULE to self-schedule (UTC)
bun run results # one-off scrape of single rally id (debug)
```

`Dockerfile` + `docker-compose.yml` included for Postgres.

## Dev

```bash
bun run typecheck
bun run check   # biome lint + format
```

## Docs

[`docs/auth.md`](docs/auth.md) · [`docs/discord.md`](docs/discord.md) · [`docs/stage-results.md`](docs/stage-results.md)
