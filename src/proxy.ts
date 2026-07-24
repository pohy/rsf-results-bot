// Rotate free HTTPS proxies from proxifly/free-proxy-list when RSF has
// banned our IP. Off by default (RSF_PROXY_ENABLED) — most free proxies are
// dead or slow, and creds should never route through one, so this is a
// last-resort switch, not the normal path. See rsfFetch in client.ts for the
// retry-with-rotation loop that uses this.
const PROXY_LIST_URL =
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt";

// Upstream list refreshes every 5min; re-fetch on that cadence rather than once per process.
const REFRESH_MS = 5 * 60_000;

let cache: { proxies: string[]; fetchedAt: number } | null = null;

async function fetchProxyList(): Promise<string[]> {
  const res = await fetch(PROXY_LIST_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) { throw new Error(`proxy list fetch failed: ${res.status}`); }
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getProxyList(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < REFRESH_MS) { return cache.proxies; }
  const proxies = await fetchProxyList();
  cache = { proxies, fetchedAt: Date.now() };
  return proxies;
}

// Random pick, excluding proxies already tried this request (so retries don't repeat a dead one).
export async function pickProxy(exclude: ReadonlySet<string>): Promise<string | null> {
  const proxies = await getProxyList();
  const candidates = proxies.filter((p) => !exclude.has(p));
  if (candidates.length === 0) { return null; }
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
