import 'dotenv/config';
import { ensureSession } from './session.js';
import { fetchAllStages } from './results.js';

async function main() {
  const username = process.env.RSF_USER;
  const password = process.env.RSF_PASS;
  const userId = Number(process.env.RSF_USER_ID);
  const rallyId = Number(process.argv[2] ?? 97248);
  const cg = Number(process.argv[3] ?? 7);
  if (!username || !password || !userId) {
    throw new Error('env RSF_USER, RSF_PASS, RSF_USER_ID required');
  }

  const { jar } = await ensureSession({
    creds: { username, password },
    userId,
    jarPath: process.env.RSF_AUTH_PATH ?? '.auth.json',
  });

  const { stages } = await fetchAllStages(jar, { rallyId, cg }, {
    delayMs: 1000,
    onStage: (e) => {
      const c = e.rows.filter((r) => r.comment).length;
      console.log(`stage ${e.stageNo}: ${e.title} — ${e.rows.length} rows, ${c} comments`);
    },
  });

  const total = stages.reduce((n, s) => n + s.rows.filter((r) => r.comment).length, 0);
  console.log(`\ntotal stages: ${stages.length}, total comments: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
