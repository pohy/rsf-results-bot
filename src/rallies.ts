import * as cheerio from "cheerio";
import { z } from "zod";
import { BASE, readHtml, rsfFetch } from "./client.js";
import type { CookieJar } from "./cookies.js";

// The online rally list (rally_online.php with no centerbox) renders every
// listed rally as a table row exposing its close time. The `rally_id` query
// param is ignored for the list view, so one fetch returns the deadlines for
// all rallies at once — used by the cron to stop polling closed rallies.
const listUrl = (): string => `${BASE}/rbr/rally_online.php`;

export const RallyMetaSchema = z.object({
  rallyId: z.number().int().positive(),
  name: z.string().min(1),
  // Epoch ms. The list prints open time as `MM-DD HH:MM` with no year (the same
  // cell's first segment); see parseListDatetime. Null when the open segment is
  // missing or unparseable — close time alone still drives finished-detection.
  startAt: z.number().int().nullable(),
  // Epoch ms. The list prints close time as `MM-DD HH:MM` with no year; see
  // parseListDatetime for year inference and timezone handling.
  deadlineAt: z.number().int(),
});
export type RallyMeta = z.infer<typeof RallyMetaSchema>;

// The site runs in Hungary; the open/close wall-clock times are Budapest local.
const SITE_TZ = "Europe/Budapest";

// Offset (ms east of UTC) of `tz` at the given instant. Lets us turn a Budapest
// wall-clock time into a UTC epoch without a timezone library.
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - utcMs;
}

function budapestToEpochMs(y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Single-pass correction: off by up to an hour only within the DST switch
  // window, which the poll cadence tolerates.
  return guess - tzOffsetMs(guess, SITE_TZ);
}

const DT_RE = /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/;

// Parse a `MM-DD HH:MM` cell. The list omits the year, so pick the year (of
// nowMs-1, nowMs, nowMs+1) that lands the timestamp closest to now — this keeps
// rallies near the present and resolves the Dec/Jan boundary correctly.
export function parseListDatetime(raw: string, nowMs: number): number | null {
  const m = DT_RE.exec(raw.trim());
  if (!m) return null;
  const [, mo, d, h, mi] = m.map(Number) as [unknown, number, number, number, number];
  const baseYear = new Date(nowMs).getUTCFullYear();
  let best: number | null = null;
  for (const y of [baseYear - 1, baseYear, baseYear + 1]) {
    const ms = budapestToEpochMs(y, mo, d, h, mi);
    if (best === null || Math.abs(ms - nowMs) < Math.abs(best - nowMs)) best = ms;
  }
  return best;
}

export function parseRallyList(html: string, nowMs: number): RallyMeta[] {
  const $ = cheerio.load(html);
  const out: RallyMeta[] = [];
  $("td.rally_list_name").each((_, el) => {
    const $name = $(el);
    const $tr = $name.closest("tr");
    const href = $name.find("a[href*='rally_id=']").attr("href") ?? "";
    const rallyId = Number(href.match(/rally_id=(\d+)/)?.[1]);
    const name = $name.find("a").first().text().trim();

    // `td.rally_list_open` holds `opens<br>closes`; the first segment is the open
    // time, the last is the close (deadline). A single-segment cell is treated as
    // close-only (startAt null) — finished-detection only needs the close time.
    const openHtml = $tr.find("td.rally_list_open").html() ?? "";
    const segments = openHtml.split(/<br\s*\/?>/i).map((s) => cheerio.load(s).text().trim());
    const closeRaw = segments[segments.length - 1] ?? "";
    const openRaw = segments.length > 1 ? (segments[0] ?? "") : "";
    const deadlineAt = parseListDatetime(closeRaw, nowMs);
    if (deadlineAt === null) return;
    const startAt = openRaw ? parseListDatetime(openRaw, nowMs) : null;

    const parsed = RallyMetaSchema.safeParse({ rallyId, name, startAt, deadlineAt });
    if (parsed.success) out.push(parsed.data);
  });
  return out;
}

export interface FetchRallyListResult {
  jar: CookieJar;
  rallies: RallyMeta[];
}

export async function fetchRallyList(jar: CookieJar, nowMs: number): Promise<FetchRallyListResult> {
  const { jar: nextJar, res } = await rsfFetch(jar, listUrl());
  if (res.status !== 200) {
    throw new Error(`rally list HTTP ${res.status}`);
  }
  const html = await readHtml(res);
  return { jar: nextJar, rallies: parseRallyList(html, nowMs) };
}
