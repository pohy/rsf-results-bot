import { jarToJSON } from "./cookies.js";
import { loadEnv } from "./env.js";
import { ensureSession } from "./session.js";

async function main() {
  const env = loadEnv();

  const { jar, source } = await ensureSession({
    creds: { username: env.RSF_USER, password: env.RSF_PASS },
    userId: env.RSF_USER_ID,
    jarPath: env.RSF_AUTH_PATH,
  });
  console.log("source:", source);
  console.log("cookies:", jarToJSON(jar));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
