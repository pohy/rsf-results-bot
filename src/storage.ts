import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { type CookieJar, jarFromJSON, jarToJSON } from "./cookies.js";

// Persisted jar shape: a flat name->value cookie map.
const JarJSONSchema = z.record(z.string(), z.string());

export async function saveJar(path: string, jar: CookieJar): Promise<void> {
  // 0o600: file contains live session cookies, treat as secret.
  await writeFile(path, JSON.stringify(jarToJSON(jar), null, 2), { encoding: "utf8", mode: 0o600 });
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
  const result = JarJSONSchema.safeParse(parsed);
  if (!result.success) return null;
  return jarFromJSON(result.data);
}
