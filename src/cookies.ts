// Single-host jar: domain/path/secure attributes are ignored. All cookies are
// assumed to apply to BASE. If BASE ever spans multiple hosts, extend this.
export type CookieJar = ReadonlyMap<string, string>;

export function createJar(): CookieJar {
  return new Map();
}

export function updateJarFromResponse(jar: CookieJar, headers: Headers): CookieJar {
  const next = new Map(jar);
  // getSetCookie() is the native Fetch API accessor for multiple Set-Cookie
  // headers; Bun.Cookie.parse reads name/value/expiry. An empty value or an
  // already-expired cookie is a deletion.
  for (const raw of headers.getSetCookie()) {
    const cookie = Bun.Cookie.parse(raw);
    if (cookie.value === '' || cookie.isExpired()) {
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
