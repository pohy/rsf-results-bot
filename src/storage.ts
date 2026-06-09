import { readFile, writeFile } from "node:fs/promises";
import { type CookieJar, jarFromJSON, jarToJSON } from "./cookies.js";

export async function saveJar(path: string, jar: CookieJar): Promise<void> {
  // 0o600: file contains live session cookies, treat as secret.
  await writeFile(path, JSON.stringify(jarToJSON(jar), null, 2), { encoding: "utf8", mode: 0o600 });
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

export async function loadJar(path: string): Promise<CookieJar | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStringRecord(parsed)) return null;
  return jarFromJSON(parsed);
}
