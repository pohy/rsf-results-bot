import { fetch, Response } from 'undici';
import { CookieJar, jarToHeader, updateJarFromResponse } from './cookies.js';

// Site serves HTML without a charset declaration; bytes are windows-1250
// (Central European). Decoding as UTF-8 produces U+FFFD for Hungarian/Czech
// characters (e.g. "Karankamäki" → "Karankam�ki"). HTML-only — guarded so
// accidental use on a JSON/other endpoint fails loud instead of corrupting.
const HTML_DECODER = new TextDecoder('windows-1250');

export async function readHtml(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) {
    throw new Error(`readHtml: expected text/html, got "${ct}"`);
  }
  return HTML_DECODER.decode(await res.arrayBuffer());
}

export const BASE = 'https://www.rallysimfans.hu';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

export interface RsfRequest {
  method?: 'GET' | 'POST';
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
    method: req.method ?? 'GET',
    headers,
    body: req.body,
    redirect: 'manual',
  });
  return { jar: updateJarFromResponse(jar, res.headers), res };
}
