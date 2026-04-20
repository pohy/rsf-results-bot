import * as cheerio from 'cheerio';
import { CookieJar } from './cookies.js';
import { BASE, rsfFetch, readHtml } from './client.js';

export interface StageRow {
  position: number;
  userId: number;
  nickname: string;
  comment: string | null;
}

export interface StageResults {
  title: string | null;
  rows: StageRow[];
}

export interface StageKey {
  rallyId: number;
  cg: number;
  stageNo: number;
}

const stageUrl = (k: StageKey): string =>
  `${BASE}/rbr/rally_online.php?centerbox=rally_results_stres.php` +
  `&rally_id=${k.rallyId}&cg=${k.cg}&stage_no=${k.stageNo}`;

function parseTitle($: cheerio.CheerioAPI): string | null {
  // Header row inside the left results table: <tr class="fejlec2">...<b>TITLE times:</b>...
  const raw = $('table.rally_results_stres_left tr.fejlec2 b').first().text().trim();
  if (!raw) return null;
  return raw.replace(/\s*times:\s*$/i, '').trim();
}

// Tip('...') uses a single-quoted JS string literal. Match the body honoring
// backslash escapes (\\ \' \" etc.) so apostrophes inside comments don't
// truncate the capture, then unescape.
const TIP_RE = /Tip\('((?:\\.|[^'\\])*)'\)/;

function extractTip(onmouseover: string): string | null {
  const m = onmouseover.match(TIP_RE);
  if (!m) return null;
  return m[1].replace(/\\(.)/g, '$1');
}

function parseRows($: cheerio.CheerioAPI): StageRow[] {
  const rows = $('tr.paros, tr.paratlan').filter(
    (_, el) => $(el).find('td.stage_results_poz').length > 0,
  );

  const out: StageRow[] = [];
  rows.each((_, el) => {
    const $tr = $(el);
    const position = Number($tr.find('td.stage_results_poz').text().trim());
    const $nameTd = $tr.find('td.stage_results_name');
    const href = $nameTd.find('a').attr('href') ?? '';
    const userId = Number(href.match(/user_stats=(\d+)/)?.[1]);
    const nickname = $nameTd.find('a > samp b').first().text().trim();
    const comment = extractTip($tr.attr('onmouseover') ?? '');

    if (!Number.isFinite(position) || !Number.isFinite(userId) || !nickname) {
      return;
    }
    out.push({ position, userId, nickname, comment });
  });
  return out;
}

function parseStageCount(html: string): number {
  // Stage nav exposes links like `stage_no=1..N`. Take the max.
  let max = 0;
  for (const m of html.matchAll(/stage_no=(\d+)/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
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

export async function fetchStageResults(
  jar: CookieJar,
  key: StageKey,
): Promise<FetchStageResult> {
  const { jar: nextJar, res } = await rsfFetch(jar, stageUrl(key));
  if (res.status !== 200) {
    throw new Error(`stage results HTTP ${res.status} for ${JSON.stringify(key)}`);
  }
  const html = await readHtml(res);
  return { jar: nextJar, stage: parseStageResults(html) };
}

export interface RallyKey {
  rallyId: number;
  cg: number;
}

export interface StageEntry extends StageResults {
  stageNo: number;
}

export interface FetchAllStagesResult {
  jar: CookieJar;
  stages: StageEntry[];
}

export interface FetchAllStagesOptions {
  delayMs?: number;
  maxRetries?: number;
  onStage?: (entry: StageEntry) => void;
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
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
      res.body?.cancel().catch(() => {});
      console.warn(`  429 on stage ${key.stageNo}, waiting ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
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
  const firstEntry: StageEntry = { stageNo: 1, ...parseStageResults(first.html) };
  stages.push(firstEntry);
  opts.onStage?.(firstEntry);

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
    opts.onStage?.(entry);
  }
  return { jar: currentJar, stages };
}
