import { type CookieJar, jarToHeader, updateJarFromResponse } from "./cookies.js";
import { decodeCp1250 } from "./cp1250.js";

// Decode HTML per the response charset. The site currently serves UTF-8
// (Content-Type: text/html; charset=utf-8). It historically served windows-1250
// (Central European) with no charset; we still honor that label for old pages —
// Bun's TextDecoder rejects "windows-1250", so it routes to a vendored decoder.
// HTML-only — guarded so accidental use on a JSON/other endpoint fails loud
// instead of corrupting.
export async function readHtml(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) {
    throw new Error(`readHtml: expected text/html, got "${ct}"`);
  }
  const charset = /charset=([^;]+)/i.exec(ct)?.[1]?.trim().toLowerCase();
  const buf = await res.arrayBuffer();
  if (charset === "windows-1250" || charset === "cp1250") {
    return decodeCp1250(buf);
  }
  // Default UTF-8: matches the live site and is the safe default for HTML.
  return new TextDecoder("utf-8").decode(buf);
}

export const BASE = "https://www.rallysimfans.hu";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export interface RsfRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface RsfResponse {
  jar: CookieJar;
  res: Response;
}

export async function rsfFetch(
  jar: CookieJar,
  url: string,
  req: RsfRequest = {},
): Promise<RsfResponse> {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(req.headers ?? {}),
    cookie: jarToHeader(jar),
  };
  // Manual redirect: login POST returns 302 on success, and the session
  // Set-Cookie arrives on that 302 itself. Auto-following would drop the
  // status signal we rely on in auth.ts to detect bad credentials.
  const res = await fetch(url, {
    method: req.method ?? "GET",
    headers,
    body: req.body,
    redirect: "manual",
  });
  return { jar: updateJarFromResponse(jar, res.headers), res };
}
