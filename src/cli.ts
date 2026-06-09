import { jarToJSON } from './cookies.js';
import { ensureSession } from './session.js';

async function main() {
  const username = process.env.RSF_USER;
  const password = process.env.RSF_PASS;
  const userId = Number(process.env.RSF_USER_ID);
  const jarPath = process.env.RSF_AUTH_PATH ?? '.auth.json';
  if (!username || !password) {
    throw new Error('RSF_USER and RSF_PASS required in env');
  }
  if (!userId) {
    throw new Error('RSF_USER_ID required in env (numeric profile id)');
  }

  const { jar, source } = await ensureSession({
    creds: { username, password },
    userId,
    jarPath,
  });
  console.log('source:', source);
  console.log('cookies:', jarToJSON(jar));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
