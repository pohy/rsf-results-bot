import { type CookieJar, jarToHeader, updateJarFromResponse } from "./cookies.js";
import { decodeCp1250 } from "./cp1250.js";
import { loadProxyEnv } from "./env.js";
import { makeLogger } from "./logger.js";
import { pickProxy } from "./proxy.js";

const logger = makeLogger("client");

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

// Bun's fetch has no default timeout: a stalled connection to the site hangs
// the request forever. In the scheduled cron that wedges the `running` latch
// so every later tick just logs "previous pass still running; skipping" and
// never scrapes again — cron alive, no error logs, no new comments. Abort each
// request so a stall throws (retried/logged) instead of hanging the pass.
// ponytail: fixed 30s ceiling, make it env-configurable if a slow page ever needs longer.
const REQUEST_TIMEOUT_MS = 30_000;

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

// Last resort for when RSF has banned our IP outright. Off by default — read
// once at load, so toggling it requires a restart, which is fine for a
// break-glass switch. See src/proxy.ts for where the list comes from.
const { RSF_PROXY_ENABLED, RSF_PROXY_MAX_ATTEMPTS } = loadProxyEnv();

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
  const doFetch = (proxy?: string): Promise<Response> =>
    fetch(url, {
      method: req.method ?? "GET",
      headers,
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(proxy ? { proxy } : {}),
    });

  if (!RSF_PROXY_ENABLED) {
    const res = await doFetch();
    return { jar: updateJarFromResponse(jar, res.headers), res };
  }

  // Free proxies are frequently dead; rotate through a few before giving up.
  // Only network-level failures (unreachable/timeout) trigger a retry — a
  // real HTTP response (even a 403) is returned as-is so callers that key off
  // status codes (e.g. auth.ts's 302-on-success check) keep working.
  const tried = new Set<string>();
  let lastErr: unknown;
  for (let attempt = 0; attempt < RSF_PROXY_MAX_ATTEMPTS; attempt++) {
    const proxy = await pickProxy(tried);
    if (!proxy) {
      logger.error(`proxy list exhausted after ${tried.size} attempt(s) for ${url}`);
      throw new Error(`rsfFetch: proxy list exhausted (${tried.size} tried) for ${url}`, {
        cause: lastErr,
      });
    }
    tried.add(proxy);
    try {
      const res = await doFetch(proxy);
      return { jar: updateJarFromResponse(jar, res.headers), res };
    } catch (err) {
      lastErr = err;
    }
  }
  logger.error(`all ${RSF_PROXY_MAX_ATTEMPTS} proxy attempts failed for ${url}`);
  throw new Error(`rsfFetch: all ${RSF_PROXY_MAX_ATTEMPTS} proxy attempts failed for ${url}`, {
    cause: lastErr,
  });
}
