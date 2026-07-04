import { z } from "zod";
import { backendDescription, makeDb } from "./db/index.js";
import { loadEnv } from "./env.js";
import { makeLogger } from "./logger.js";
import { persistStage } from "./persist.js";
import { fetchAllStages, type RallyKey } from "./results.js";
import { ensureSession } from "./session.js";

// Positional CLI arg: rally id. The default applies when the arg is absent
// (undefined short-circuits .default); a present-but-non-numeric arg fails.
const positionalId = z.coerce.number().int().positive();

const logger = makeLogger("probe");

async function main() {
  const env = loadEnv();
  const rallyId = positionalId.default(99639).parse(process.argv[2]); //97248);

  const { jar } = await ensureSession({
    creds: { username: env.RSF_USER, password: env.RSF_PASS },
    userId: env.RSF_USER_ID,
    jarPath: env.RSF_AUTH_PATH,
  });

  const db = makeDb(env);
  const rally: RallyKey = { rallyId };
  logger.log(`persisting to ${backendDescription(env)}`);
  let newComments = 0;
  let failedStages = 0;
  try {
    const { stages } = await fetchAllStages(jar, rally, {
      delayMinMs: 1000,
      delayMaxMs: 1000,
      // Persist failures are logged with stage context and counted, not thrown,
      // so one bad stage doesn't discard the rest of the scrape. A non-zero exit
      // at the end signals that something didn't persist.
      onStage: async (e) => {
        try {
          const res = await persistStage(db, rally, e, Date.now());
          newComments += res.newComments.length;
          logger.log(
            `stage ${e.stageNo}: ${e.title} — ${e.rows.length} rows, ${res.newComments.length} new/changed comments`,
          );
        } catch (err) {
          failedStages++;
          logger.error(`persist FAILED for stage ${e.stageNo} (${e.title}):`, err);
        }
      },
    });
    logger.log(
      `\ntotal stages: ${stages.length}, new/changed comments this run: ${newComments}` +
        (failedStages > 0 ? `, ${failedStages} stage(s) failed to persist` : ""),
    );
  } finally {
    await db.destroy();
  }

  if (failedStages > 0) {
    throw new Error(`${failedStages} stage(s) failed to persist`);
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
