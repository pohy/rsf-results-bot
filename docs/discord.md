# Discord Integration

`src/bot.ts` (gateway + commands), `src/watched.ts` (`watched_rally` queries), `src/results.ts` (URL/name parsing). Run `bun run bot` after `bun run migrate`.

One **gateway bot** owns all Discord interaction. Users manage watch list via slash commands; bot writes to `watched_rally`. Only reads/writes that one table — never scrapes, never posts results. Cron does that, decoupled.

Gateway, not webhook: webhook is send-only, can't receive commands. Watch list needs user input → always-on gateway connection. No privileged intent (default `Guilds` only).

## Commands

```
/watch add    url:<rally URL> channel:<#channel> [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch edit   rally:<id> [channel:<#channel>] [send_old_comments:<bool>] [include_rally_title:<mode>]
/watch remove rally:<id>
/watch list   [status:<active|inactive|all>]
```

- `add` — takes rally **URL** (any `centerbox`; `rally_id` parsed from query, `cg` ignored). Name parsed from public details page. Rejects already-watched. 404 or unparseable name → ephemeral error, writes nothing.
- `channel` — required. Per-rally target; cron batches per channel, never mixes rooms. Falls back to `DISCORD_RESULTS_CHANNEL_ID` for unwatched rallies.
- `send_old_comments` — default off. On posts comment backlog on first scrape.
- `include_rally_title` — `Off`/`On`/`Contextual` (show only when channel's last title differs).
- `remove` — by rally id. `edit` — change settings (not URL). `list` — ephemeral, masked link + `<#channel>` mention. `status` (default `active`) filters by deadline: `active` (null or ahead of now), `inactive` (past), `all`. Output over 2000 chars splits across follow-up messages.

All commands gated to `DISCORD_ALLOWED_USER_IDS` allowlist. Non-allowed → "not authorized", no action. Ids are 64-bit snowflakes — compare as strings.

## Setup

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** → `.env` `DISCORD_BOT_TOKEN` (secret). All **Privileged Gateway Intents** OFF.
3. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`. Open URL, invite bot to server.
4. **Application ID** → `DISCORD_APP_ID`. Server id → `DISCORD_GUILD_ID` (guild-scoped = instant registration; global ~1h). Commands registered on bot startup (idempotent `PUT`).
5. User ids (Developer Mode → right-click → Copy User ID) → `DISCORD_ALLOWED_USER_IDS`.

## Environment

| Variable                   | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `DISCORD_BOT_TOKEN`        | Gateway bot auth. Secret.                         |
| `DISCORD_APP_ID`           | App id, for command registration.                 |
| `DISCORD_GUILD_ID`         | Register commands to this guild (instant).        |
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated user ids allowed to run commands. |
