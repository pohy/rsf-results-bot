import { jarToJSON } from "./cookies.js";
import { loadEnv } from "./env.js";
import { makeLogger } from "./logger.js";
import { ensureSession } from "./session.js";

const logger = makeLogger("cli");

async function main() {
  const env = loadEnv();

  const { jar, source } = await ensureSession({
    creds: { username: env.RSF_USER, password: env.RSF_PASS },
    userId: env.RSF_USER_ID,
    jarPath: env.RSF_AUTH_PATH,
  });
  logger.log("source:", source);
  logger.log("cookies:", jarToJSON(jar));
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
