import { z } from "zod";

// Single source for runtime env: validation, coercion, and defaults. Parsed once
// at process start; callers receive a typed, validated object instead of poking
// process.env.

// Coolify (and Docker Compose env_file) pass values verbatim, wrapping any value
// containing spaces in literal quotes — so `'*/15 * * * *'` arrives quotes-and-all
// and fails cron parsing. Strip one layer of surrounding matching quotes.
const unquote = (raw: string): string => {
  const s = raw.trim();
  const quote = s[0];
  if ((quote === '"' || quote === "'") && s.length >= 2 && s.at(-1) === quote) {
    return s.slice(1, -1);
  }
  return s;
};

// Backend selection only. Split out so migrate.ts / db code can validate without
// requiring the auth creds they don't use. DATABASE_URL absent => sqlite backend.
const DbEnvSchema = z.object({
  DATABASE_URL: z.url().optional(),
  SQLITE_PATH: z.string().default("./data/dev.sqlite"),
});

const EnvSchema = DbEnvSchema.extend({
  RSF_USER: z.string().min(1),
  RSF_PASS: z.string().min(1),
  RSF_USER_ID: z.coerce.number().int().positive(),
  RSF_AUTH_PATH: z.string().default(".auth.json"),
});

// Discord bot config. The bot only writes the watched_rally table and reads
// public rally pages, so it needs the DB env but not the RSF login creds.
const DiscordEnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  // Comma-separated Discord user ids allowed to run commands. Snowflakes are
  // 64-bit; keep them as strings and never parse to number.
  DISCORD_ALLOWED_USER_IDS: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^\d+$/, "must be a numeric user id")).min(1)),
});

const BotEnvSchema = DbEnvSchema.extend(DiscordEnvSchema.shape);

// Cron scraper config. It logs in (RSF creds), reads watched_rally + scrapes
// results (DB env), and posts new comments via the bot token to each rally's
// configured channel (watched_rally.channel_id). DISCORD_RESULTS_CHANNEL_ID is
// the value the 0006 migration backfills existing rallies to (and which that
// migration requires), plus the fallback for comments whose rally has since been
// unwatched. CRON_SCHEDULE absent => run a single pass and exit
// (drive it from an external scheduler); set it to a cron expression to
// self-schedule via Bun.cron (interpreted as UTC). Delays throttle requests so
// we don't hammer the site: between stages of a rally, and between rallies.
const CronEnvSchema = EnvSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_RESULTS_CHANNEL_ID: z.string().regex(/^\d+$/, "must be a numeric channel id"),
  CRON_SCHEDULE: z.string().transform(unquote).pipe(z.string().min(1)).optional(),
  CRON_STAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  CRON_RALLY_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),
});

export type DbEnv = z.infer<typeof DbEnvSchema>;
export type Env = z.infer<typeof EnvSchema>;
export type BotEnv = z.infer<typeof BotEnvSchema>;
export type CronEnv = z.infer<typeof CronEnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>): T {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    throw new Error(`invalid environment:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}

export const loadEnv = (): Env => parseOrThrow(EnvSchema);
export const loadDbEnv = (): DbEnv => parseOrThrow(DbEnvSchema);
export const loadBotEnv = (): BotEnv => parseOrThrow(BotEnvSchema);
export const loadCronEnv = (): CronEnv => parseOrThrow(CronEnvSchema);
