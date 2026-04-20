import { getSetCookies, Headers } from 'undici';

// Single-host jar: domain/path/secure attributes are ignored. All cookies are
// assumed to apply to BASE. If BASE ever spans multiple hosts, extend this.
export type CookieJar = ReadonlyMap<string, string>;

export function createJar(): CookieJar {
  return new Map();
}

function isExpired(cookie: { maxAge?: number; expires?: number | Date }): boolean {
  if (cookie.maxAge !== undefined && cookie.maxAge <= 0) return true;
  if (cookie.expires !== undefined) {
    const t = cookie.expires instanceof Date ? cookie.expires.getTime() : cookie.expires;
    if (t <= Date.now()) return true;
  }
  return false;
}

export function updateJarFromResponse(jar: CookieJar, headers: Headers): CookieJar {
  const next = new Map(jar);
  for (const cookie of getSetCookies(headers)) {
    if (cookie.value === '' || isExpired(cookie)) {
      next.delete(cookie.name);
      continue;
    }
    next.set(cookie.name, cookie.value);
  }
  return next;
}

export function jarToHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function jarToJSON(jar: CookieJar): Record<string, string> {
  return Object.fromEntries(jar);
}

export function jarFromJSON(obj: Record<string, string>): CookieJar {
  return new Map(Object.entries(obj));
}
