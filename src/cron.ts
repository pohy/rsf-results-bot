import { REST, Routes } from "discord.js";
import type { Kysely } from "kysely";
import { backendDescription, makeDb } from "./db/index.js";
import type { Database } from "./db/schema.js";
import { type CronEnv, loadCronEnv } from "./env.js";
import { persistStage } from "./persist.js";
import { fetchAllStages, type RallyKey } from "./results.js";
import { ensureSession } from "./session.js";
import { listWatched } from "./watched.js";

// Periodic scraper. Each pass: re-read the watched_rally table (so /watch
// add/remove from the Discord bot take effect without a restart), then scrape
// each watched rally one at a time — never in parallel — with delays between
// stages and between rallies so we don't hammer rallysimfans.hu. New comments
// found across the whole pass are batched into a single Discord message.
//
// CRON_SCHEDULE unset => one pass then exit (run from an external scheduler).
// Set it to a cron expression to self-schedule via Bun.cron (UTC). A pass that
// overruns into the next tick is skipped, never overlapped.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// One new comment with its rally context, ready to render in the post.
interface PassComment {
  rallyName: string;
  stageNo: number;
  nickname: string;
  comment: string;
}

// Scrape every watched rally once, persisting as we go, and return the comments
// seen for the first time this pass. A single rally failing is logged and
// skipped — it doesn't abort the rest of the pass.
async function runPass(db: Kysely<Database>, env: CronEnv): Promise<PassComment[]> {
  const rallies = await listWatched(db);
  if (rallies.length === 0) {
    console.log("no watched rallies");
    return [];
  }

  const session = await ensureSession({
    creds: { username: env.RSF_USER, password: env.RSF_PASS },
    userId: env.RSF_USER_ID,
    jarPath: env.RSF_AUTH_PATH,
  });
  let jar = session.jar;
  const now = Date.now();
  const collected: PassComment[] = [];

  for (let i = 0; i < rallies.length; i++) {
    const rally = rallies[i];
    const key: RallyKey = { rallyId: rally.rallyId };
    try {
      const { jar: nextJar, stages } = await fetchAllStages(jar, key, {
        delayMs: env.CRON_STAGE_DELAY_MS,
      });
      jar = nextJar;
      for (const stage of stages) {
        const { newComments } = await persistStage(db, key, stage, now);
        for (const c of newComments) {
          collected.push({
            rallyName: rally.name,
            stageNo: c.stageNo,
            nickname: c.nickname,
            comment: c.comment,
          });
        }
      }
      console.log(`rally ${rally.rallyId} (${rally.name}): ${stages.length} stage(s) scraped`);
    } catch (err) {
      console.error(`rally ${rally.rallyId} (${rally.name}) failed:`, err);
    }
    // Polite gap before the next rally; skip it after the last one.
    if (i < rallies.length - 1) await sleep(env.CRON_RALLY_DELAY_MS);
  }

  return collected;
}

// Discord caps a message at 2000 chars. Build under that and report any overflow
// instead of silently dropping comments.
const DISCORD_LIMIT = 2000;
const OVERFLOW_RESERVE = 40;

// Render new comments grouped by rally, then stage:
//
//   **Rally name**
//   > S1
//   Driver: *comment*
//   > S2
//   Other: *comment*
//
// Rallies and driver names are ordered by localeCompare; stages by stage number
// (numeric-aware localeCompare so S2 sorts before S10).
function formatMessage(comments: PassComment[]): string {
  const byRally = new Map<string, Map<number, PassComment[]>>();
  for (const c of comments) {
    const stages = byRally.get(c.rallyName) ?? new Map<number, PassComment[]>();
    const drivers = stages.get(c.stageNo) ?? [];
    drivers.push(c);
    stages.set(c.stageNo, drivers);
    byRally.set(c.rallyName, stages);
  }

  const lines: string[] = [];
  for (const rallyName of [...byRally.keys()].sort((a, b) => a.localeCompare(b))) {
    const stages = byRally.get(rallyName) as Map<number, PassComment[]>;
    lines.push(`**${rallyName}**`);
    const stageNos = [...stages.keys()].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    );
    for (const stageNo of stageNos) {
      lines.push(`> S${stageNo}`);
      const drivers = [...(stages.get(stageNo) as PassComment[])].sort((a, b) =>
        a.nickname.localeCompare(b.nickname),
      );
      for (const d of drivers) lines.push(`${d.nickname}: *${d.comment}*`);
    }
  }

  const out: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = (out.length > 0 ? 1 : 0) + line.length;
    if (len + add > DISCORD_LIMIT - OVERFLOW_RESERVE) break;
    out.push(line);
    len += add;
  }
  if (out.length < lines.length) out.push(`…and ${lines.length - out.length} more line(s)`);
  return out.join("\n");
}

async function postMessage(env: CronEnv, content: string): Promise<void> {
  // REST-only (no gateway): the cron just posts, it doesn't receive events.
  const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);
  await rest.post(Routes.channelMessages(env.DISCORD_RESULTS_CHANNEL_ID), { body: { content } });
}

// One scrape pass plus its single Discord post.
async function runAndPost(db: Kysely<Database>, env: CronEnv): Promise<void> {
  const comments = await runPass(db, env);
  if (comments.length > 0) {
    await postMessage(env, formatMessage(comments));
    console.log(`posted ${comments.length} new comment(s)`);
  } else {
    console.log("no new comments this run");
  }
}

async function main(): Promise<void> {
  const env = loadCronEnv();
  const db = makeDb(env);
  console.log(`cron persisting to ${backendDescription(env)}`);

  // No schedule: run a single pass and exit (driven by an external scheduler).
  if (!env.CRON_SCHEDULE) {
    try {
      await runAndPost(db, env);
    } finally {
      await db.destroy();
    }
    return;
  }

  // Scheduled in-process via Bun.cron (UTC). Bun.cron doesn't serialize ticks,
  // so guard against a slow pass overlapping the next one — skip rather than run
  // two scrapes against the site at once. The same guard makes the leading-edge
  // pass and the first scheduled tick safe if they coincide.
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) {
      console.log("previous pass still running; skipping this tick");
      return;
    }
    running = true;
    try {
      await runAndPost(db, env);
    } catch (err) {
      console.error("pass failed:", err);
    } finally {
      running = false;
    }
  };

  const job = Bun.cron(env.CRON_SCHEDULE, tick);
  console.log(`scheduled: ${env.CRON_SCHEDULE} (UTC)`);

  // Stop the job and close the DB on a termination signal so the process exits
  // cleanly instead of being killed mid-pass. Registered before the leading-edge
  // pass so Ctrl-C during that first (possibly long) scrape is still handled.
  const shutdown = async (sig: string): Promise<void> => {
    console.log(`${sig} received, shutting down`);
    job.stop();
    await db.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Leading edge: scrape once on startup instead of waiting for the first tick.
  await tick();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
