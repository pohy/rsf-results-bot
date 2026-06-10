import { REST, Routes } from "discord.js";
import type { Kysely } from "kysely";
import { backendDescription, makeDb } from "./db/index.js";
import type { Database } from "./db/schema.js";
import { type CronEnv, loadCronEnv } from "./env.js";
import { formatError } from "./errors.js";
import { makeLogger } from "./logger.js";
import {
  markDelivered,
  persistStage,
  selectUndelivered,
  type UndeliveredComment,
} from "./persist.js";
import { selectPollable } from "./poll.js";
import { fetchRallyList } from "./rallies.js";
import { fetchAllStages, type RallyKey } from "./results.js";
import { ensureSession } from "./session.js";
import { listWatched, updateDeadlines } from "./watched.js";

// Periodic scraper. Each pass: re-read the watched_rally table (so /watch
// add/remove from the Discord bot take effect without a restart), then scrape
// each watched rally one at a time — never in parallel — with delays between
// stages and between rallies so we don't hammer rallysimfans.hu. New comments
// found across the whole pass are batched into a single Discord message.
//
// CRON_SCHEDULE unset => one pass then exit (run from an external scheduler).
// Set it to a cron expression to self-schedule via Bun.cron (UTC). A pass that
// overruns into the next tick is skipped, never overlapped.

const logger = makeLogger("cron");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Scrape every watched rally once, persisting as we go. New comments are written
// undelivered (delivered_at null); the caller posts them separately and only then
// marks them delivered, so a failed post is retried next pass. A single rally
// failing is logged and skipped — it doesn't abort the rest of the pass.
async function runPass(db: Kysely<Database>, env: CronEnv): Promise<void> {
  const watched = await listWatched(db);
  if (watched.length === 0) {
    logger.log("no watched rallies");
    return;
  }

  const session = await ensureSession({
    creds: { username: env.RSF_USER, password: env.RSF_PASS },
    userId: env.RSF_USER_ID,
    jarPath: env.RSF_AUTH_PATH,
  });
  let jar = session.jar;
  const now = Date.now();

  // Refresh close times from the rally list so finished rallies can be skipped.
  // One fetch covers every rally. A failure here just means we poll on with the
  // deadlines already stored, never that we wrongly skip a rally.
  try {
    const { jar: nextJar, rallies: metas } = await fetchRallyList(jar, now);
    jar = nextJar;
    const updated = await updateDeadlines(db, metas);
    logger.log(`synced deadlines: ${updated}/${watched.length} watched matched the rally list`);
  } catch (err) {
    logger.error("deadline sync failed; polling with stored deadlines:", formatError(err));
  }

  // Skip rallies that have closed and already had a full scrape after closing —
  // no new results or comments can land, so there's nothing left to poll.
  const rallies = await selectPollable(db, now);
  const skipped = watched.length - rallies.length;
  if (skipped > 0) {
    logger.log(`skipping ${skipped} finished rally(ies) (closed, comments parsed)`);
  }
  if (rallies.length === 0) return;

  for (let i = 0; i < rallies.length; i++) {
    const rally = rallies[i];
    const key: RallyKey = { rallyId: rally.rallyId };
    try {
      const { jar: nextJar, stages } = await fetchAllStages(jar, key, {
        delayMs: env.CRON_STAGE_DELAY_MS,
      });
      jar = nextJar;
      for (const stage of stages) {
        await persistStage(db, key, stage, now);
      }
      logger.log(`rally ${rally.rallyId} (${rally.name}): ${stages.length} stage(s) scraped`);
    } catch (err) {
      logger.error(`rally ${rally.rallyId} (${rally.name}) failed:`, formatError(err));
    }
    // Polite gap before the next rally; skip it after the last one.
    if (i < rallies.length - 1) await sleep(env.CRON_RALLY_DELAY_MS);
  }
}

// Discord caps a message at 2000 chars. A pass packs the whole backlog into as
// many messages as it takes (see formatMessages) and posts them all in the same
// pass; the caller marks each message's comments delivered only after that
// message posts, so anything not yet posted stays undelivered — nothing is dropped.
const DISCORD_LIMIT = 2000;

interface FormattedMessage {
  content: string;
  // The comments rendered into `content`; only these may be marked delivered.
  included: UndeliveredComment[];
}

// Render undelivered comments grouped by rally, then stage:
//
//   **Rally name**
//   > Granbacken
//   Driver: *comment*
//   > Kuri Bush 2
//   Other: *comment*
//
// The stage header is the scraped stage name, falling back to S<no> when no
// title was stored. Rallies and driver names are ordered by localeCompare;
// stages by stage number (numeric-aware so S2 sorts before S10). Comments are added until
// the next one wouldn't fit under DISCORD_LIMIT, and a rally/stage header is only
// emitted once a comment beneath it fits — so the message never ends on a
// dangling header, and the comments left out are packed into the next message by
// formatMessages. If the very first comment's line alone exceeds the limit it's
// truncated and still included, so one over-long comment can't wedge the queue
// forever.
function formatMessage(comments: UndeliveredComment[]): FormattedMessage {
  const byRally = new Map<string, Map<number, UndeliveredComment[]>>();
  for (const c of comments) {
    const stages = byRally.get(c.rallyName) ?? new Map<number, UndeliveredComment[]>();
    const drivers = stages.get(c.stageNo) ?? [];
    drivers.push(c);
    stages.set(c.stageNo, drivers);
    byRally.set(c.rallyName, stages);
  }

  const lines: string[] = [];
  const included: UndeliveredComment[] = [];
  let textSum = 0; // sum of committed line lengths (newlines added separately)
  // Joined length if `addLines` lines of total text `addText` were appended.
  const joinedLen = (addText: number, addLines: number): number => {
    const lc = lines.length + addLines;
    return textSum + addText + Math.max(0, lc - 1);
  };

  outer: for (const rallyName of [...byRally.keys()].sort((a, b) => a.localeCompare(b))) {
    const stages = byRally.get(rallyName) as Map<number, UndeliveredComment[]>;
    let rallyAdded = false;
    const stageNos = [...stages.keys()].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    );
    for (const stageNo of stageNos) {
      let stageAdded = false;
      const drivers = [...(stages.get(stageNo) as UndeliveredComment[])].sort((a, b) =>
        a.nickname.localeCompare(b.nickname),
      );
      for (const d of drivers) {
        const driverLine = `${d.nickname}: *${d.comment}*`;
        const cand: string[] = [];
        if (!rallyAdded) cand.push(`**${rallyName}**`);
        if (!stageAdded) cand.push(`> ${d.stageTitle ?? `S${stageNo}`}`);
        cand.push(driverLine);
        const addText = cand.reduce((n, l) => n + l.length, 0);

        if (joinedLen(addText, cand.length) > DISCORD_LIMIT) {
          // Nothing committed yet and even this first comment overflows: truncate
          // its line to fit so the backlog can still drain, then stop.
          if (lines.length === 0) {
            const headers = cand.slice(0, -1);
            const headerText = headers.reduce((n, l) => n + l.length, 0);
            const room = DISCORD_LIMIT - headerText - headers.length;
            lines.push(...headers, driverLine.slice(0, Math.max(0, room)));
            included.push(d);
          }
          break outer;
        }

        lines.push(...cand);
        textSum += addText;
        rallyAdded = true;
        stageAdded = true;
        included.push(d);
      }
    }
  }

  return { content: lines.join("\n"), included };
}

// Pack the entire backlog into a sequence of messages, each under DISCORD_LIMIT.
// formatMessage packs one message's worth and reports which comments it included;
// we drop those and repeat on the rest until none remain. formatMessage always
// includes at least one comment per call when given a non-empty list (the
// over-long-comment case truncates rather than skipping), so this terminates.
function formatMessages(comments: UndeliveredComment[]): FormattedMessage[] {
  const messages: FormattedMessage[] = [];
  let remaining = comments;
  while (remaining.length > 0) {
    const message = formatMessage(remaining);
    messages.push(message);
    const included = new Set(message.included);
    remaining = remaining.filter((c) => !included.has(c));
  }
  return messages;
}

async function postMessage(env: CronEnv, content: string): Promise<void> {
  // REST-only (no gateway): the cron just posts, it doesn't receive events.
  const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);
  await rest.post(Routes.channelMessages(env.DISCORD_RESULTS_CHANNEL_ID), { body: { content } });
}

// One scrape pass plus its Discord posts. The pass persists new comments
// undelivered; we then post every undelivered comment (including any left over
// from an earlier failed post), splitting across as many messages as the backlog
// needs and stamping each message's comments delivered only once that message
// posts. If a post throws, the already-posted messages stay delivered and the
// rest keep delivered_at null, so they're retried next pass instead of lost.
async function runAndPost(db: Kysely<Database>, env: CronEnv): Promise<void> {
  await runPass(db, env);

  const pending = await selectUndelivered(db);
  if (pending.length === 0) {
    logger.log("no new comments this run");
    return;
  }

  const messages = formatMessages(pending);
  let posted = 0;
  for (const { content, included } of messages) {
    await postMessage(env, content);
    await markDelivered(db, included, Date.now());
    posted += included.length;
  }

  logger.log(`posted ${posted} comment(s) in ${messages.length} message(s)`);
}

async function main(): Promise<void> {
  const env = loadCronEnv();
  const db = makeDb(env);
  logger.log(`cron persisting to ${backendDescription(env)}`);

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
      logger.log("previous pass still running; skipping this tick");
      return;
    }
    running = true;
    try {
      await runAndPost(db, env);
    } catch (err) {
      logger.error("pass failed:", formatError(err));
    } finally {
      running = false;
    }
  };

  const job = Bun.cron(env.CRON_SCHEDULE, tick);
  logger.log(`scheduled: ${env.CRON_SCHEDULE} (UTC)`);

  // Stop the job and close the DB on a termination signal so the process exits
  // cleanly instead of being killed mid-pass. Registered before the leading-edge
  // pass so Ctrl-C during that first (possibly long) scrape is still handled.
  const shutdown = async (sig: string): Promise<void> => {
    logger.log(`${sig} received, shutting down`);
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
  logger.error(formatError(e));
  process.exit(1);
});
