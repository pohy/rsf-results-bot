import * as cheerio from "cheerio";
import { z } from "zod";
import { BASE, readHtml, rsfFetch } from "./client.js";
import { type CookieJar, createJar } from "./cookies.js";
import { makeLogger } from "./logger.js";
import { parseTimeMs } from "./time.js";

const logger = makeLogger("results");

// Extract the rally id from any rallysimfans rally URL. The id lives in the
// `rally_id` query param regardless of which `centerbox` page the URL points at
// (rally_results.php, rally_list_details.php, ...). `cg` (car group), if
// present, is ignored. Returns null for a non-URL or a missing/invalid id.
export function rallyIdFromUrl(input: string): number | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const raw = url.searchParams.get("rally_id");
  if (!raw) { return null; }
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const rallyDetailsUrl = (rallyId: number): string =>
  `${BASE}/rbr/rally_online.php?centerbox=rally_list_details.php&rally_id=${rallyId}`;

// The rally name sits in the bold cell of the "Rally info" header table:
//   <div class="fejlec4">Rally info</div>
//   <table ...><tr class="fejlec"><td colspan="3"><b>NAME</td>...
export function parseRallyName(html: string): string | null {
  const $ = cheerio.load(html);
  const heading = $("div.fejlec4")
    .filter((_, el) => $(el).text().trim() === "Rally info")
    .first();
  const name = heading.next("table").find("tr.fejlec td b").first().text().trim();
  return name || null;
}

// Fetch a rally's name from its public details page (no login required). Throws
// on a non-200; returns null when the page loads but the name can't be parsed.
export async function fetchRallyName(rallyId: number): Promise<string | null> {
  const { res } = await rsfFetch(createJar(), rallyDetailsUrl(rallyId));
  if (res.status !== 200) {
    throw new Error(`rally details HTTP ${res.status} for rally ${rallyId}`);
  }
  return parseRallyName(await readHtml(res));
}

export const StageRowSchema = z.object({
  // Null for Super Rally ("SR") rows: a driver who restarted has no finishing
  // position for the stage and the site prints "SR" in the position cell.
  // Regular finishers carry a positive integer.
  position: z.number().int().positive().nullable(),
  userId: z.number().int().positive(),
  nickname: z.string().min(1),
  comment: z.string().nullable(),
  // Milliseconds. Null when the cell is empty or unparseable.
  stageTimeMs: z.number().nullable(),
  diffPrevMs: z.number().nullable(),
  diffFirstMs: z.number().nullable(),
});
export type StageRow = z.infer<typeof StageRowSchema>;

export const StageResultsSchema = z.object({
  title: z.string().nullable(),
  rows: z.array(StageRowSchema),
});
export type StageResults = z.infer<typeof StageResultsSchema>;

export interface StageKey {
  rallyId: number;
  stageNo: number;
}

export const stageUrl = (k: StageKey): string =>
  // Omitting the site's `cg` (car group) param returns the full field: car groups
  // are nested subsets of the overall results, so no-cg == the union of all groups.
  `${BASE}/rbr/rally_online.php?centerbox=rally_results_stres.php` +
  `&rally_id=${k.rallyId}&stage_no=${k.stageNo}`;

function parseTitle($: cheerio.CheerioAPI): string | null {
  // Header row inside the left results table: <tr class="fejlec2">...<b>TITLE times:</b>...
  const raw = $("table.rally_results_stres_left tr.fejlec2 b").first().text().trim();
  if (!raw) { return null; }
  return raw.replace(/\s*times:\s*$/i, "").trim();
}

// Tip('...') uses a single-quoted JS string literal. Match the body honoring
// backslash escapes (\\ \' \" etc.) so apostrophes inside comments don't
// truncate the capture, then unescape.
const TIP_RE = /Tip\('((?:\\.|[^'\\])*)'\)/;

function extractTip(onmouseover: string): string | null {
  const m = onmouseover.match(TIP_RE);
  if (!m) { return null; }
  return m[1].replace(/\\(.)/g, "$1") || null;
}

// Position cell holds a positive integer for finishers, or the literal "SR" for
// Super Rally rows (a restart — no finishing position). Return null for anything
// that isn't a positive integer so SR rows still parse (and carry their comment).
function parsePosition(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseRows($: cheerio.CheerioAPI): StageRow[] {
  // SR (Super Rally) rows use the `_sr` stripe-class variants, so match those
  // too — they carry comments and would otherwise be dropped silently.
  const rows = $("tr.paros, tr.paratlan, tr.paros_sr, tr.paratlan_sr").filter(
    (_, el) => $(el).find("td.stage_results_poz").length > 0,
  );

  const out: StageRow[] = [];
  rows.each((_, el) => {
    const $tr = $(el);
    const $nameTd = $tr.find("td.stage_results_name");
    const href = $nameTd.find("a").attr("href") ?? "";
    const candidate = {
      position: parsePosition($tr.find("td.stage_results_poz").text()),
      userId: Number(href.match(/user_stats=(\d+)/)?.[1]),
      nickname: $nameTd.find("a > samp b").first().text().trim(),
      comment: extractTip($tr.attr("onmouseover") ?? ""),
      stageTimeMs: parseTimeMs($tr.find("td.stage_results_time").text()),
      diffPrevMs: parseTimeMs($tr.find("td.stage_results_diff_prev").text()),
      diffFirstMs: parseTimeMs($tr.find("td.stage_results_diff_first").text()),
    };

    // Drop header/spacer rows and any row missing a valid user id or nickname;
    // the schema is the single guard for a well-formed result row. Position may
    // be null (SR rows), so user id + nickname are what separate a result row
    // from a spacer.
    const parsed = StageRowSchema.safeParse(candidate);
    if (parsed.success) { out.push(parsed.data); }
  });
  return out;
}

function parseStageCount(html: string): number {
  // Stage nav exposes links like `stage_no=1..N`. Take the max.
  let max = 0;
  for (const m of html.matchAll(/stage_no=(\d+)/g)) {
    const n = Number(m[1]);
    if (n > max) { max = n; }
  }
  return max;
}

export function parseStageResults(html: string): StageResults {
  const $ = cheerio.load(html);
  return { title: parseTitle($), rows: parseRows($) };
}

export interface FetchStageResult {
  jar: CookieJar;
  stage: StageResults;
}

export async function fetchStageResults(jar: CookieJar, key: StageKey): Promise<FetchStageResult> {
  const { jar: nextJar, res } = await rsfFetch(jar, stageUrl(key));
  if (res.status !== 200) {
    throw new Error(`stage results HTTP ${res.status} for ${JSON.stringify(key)}`);
  }
  const html = await readHtml(res);
  return { jar: nextJar, stage: parseStageResults(html) };
}

export interface RallyKey {
  rallyId: number;
}

export const StageEntrySchema = StageResultsSchema.extend({
  stageNo: z.number().int().positive(),
});
export type StageEntry = z.infer<typeof StageEntrySchema>;

export interface FetchAllStagesResult {
  jar: CookieJar;
  stages: StageEntry[];
}

export interface FetchAllStagesOptions {
  delayMs?: number;
  maxRetries?: number;
  onStage?: (entry: StageEntry) => void | Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchStageHtmlResult {
  jar: CookieJar;
  html: string;
}

async function fetchStageHtmlWithRetry(
  jar: CookieJar,
  key: StageKey,
  maxRetries: number,
): Promise<FetchStageHtmlResult> {
  let backoff = 2000;
  let currentJar = jar;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { jar: nextJar, res } = await rsfFetch(currentJar, stageUrl(key));
    if (res.status === 200) {
      const html = await readHtml(res);
      return { jar: nextJar, html };
    }
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
      res.body?.cancel().catch(() => {});
      logger.warn(
        `  429 on stage ${key.stageNo}, waiting ${wait}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await sleep(wait);
      backoff *= 2;
      currentJar = nextJar;
      continue;
    }
    throw new Error(`stage results HTTP ${res.status} for ${JSON.stringify(key)}`);
  }
  throw new Error(`stage results retries exhausted for ${JSON.stringify(key)}`);
}

export async function fetchAllStages(
  jar: CookieJar,
  rally: RallyKey,
  opts: FetchAllStagesOptions = {},
): Promise<FetchAllStagesResult> {
  const delayMs = opts.delayMs ?? 3000;
  const maxRetries = opts.maxRetries ?? 4;

  const first = await fetchStageHtmlWithRetry(jar, { ...rally, stageNo: 1 }, maxRetries);
  const count = parseStageCount(first.html);
  if (count < 1) {
    throw new Error(`no stages discovered for ${JSON.stringify(rally)}`);
  }

  const stages: StageEntry[] = [];
  const firstEntry: StageEntry = {
    stageNo: 1,
    ...parseStageResults(first.html),
  };
  stages.push(firstEntry);
  await opts.onStage?.(firstEntry);

  let currentJar = first.jar;
  for (let stageNo = 2; stageNo <= count; stageNo++) {
    await sleep(delayMs);
    const { jar: nextJar, html } = await fetchStageHtmlWithRetry(
      currentJar,
      { ...rally, stageNo },
      maxRetries,
    );
    currentJar = nextJar;
    const entry: StageEntry = { stageNo, ...parseStageResults(html) };
    stages.push(entry);
    await opts.onStage?.(entry);
  }
  return { jar: currentJar, stages };
}
