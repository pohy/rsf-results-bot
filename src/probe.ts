import { backendDescription, makeDb } from "./db/index.js";
import { persistStage } from "./persist.js";
import { fetchAllStages, type RallyKey } from "./results.js";
import { ensureSession } from "./session.js";

async function main() {
  const username = process.env.RSF_USER;
  const password = process.env.RSF_PASS;
  const userId = Number(process.env.RSF_USER_ID);
  const rallyId = Number(process.argv[2] ?? 99639); //97248);
  const carGroupId = Number(process.argv[3] ?? 7);
  if (!username || !password || !userId) {
    throw new Error("env RSF_USER, RSF_PASS, RSF_USER_ID required");
  }

  const { jar } = await ensureSession({
    creds: { username, password },
    userId,
    jarPath: process.env.RSF_AUTH_PATH ?? ".auth.json",
  });

  const db = makeDb();
  const rally: RallyKey = { rallyId, carGroupId };
  console.log(`persisting to ${backendDescription()}`);
  let newComments = 0;
  let failedStages = 0;
  try {
    const { stages } = await fetchAllStages(jar, rally, {
      delayMs: 1000,
      // Persist failures are logged with stage context and counted, not thrown,
      // so one bad stage doesn't discard the rest of the scrape. A non-zero exit
      // at the end signals that something didn't persist.
      onStage: async (e) => {
        try {
          const res = await persistStage(db, rally, e, Date.now());
          newComments += res.newComments;
          console.log(
            `stage ${e.stageNo}: ${e.title} — ${e.rows.length} rows, ${res.newComments} new/changed comments`,
          );
        } catch (err) {
          failedStages++;
          console.error(`persist FAILED for stage ${e.stageNo} (${e.title}):`, err);
        }
      },
    });
    console.log(
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
  console.error(e);
  process.exit(1);
});
