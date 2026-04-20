# Stage results page

## URL

```
https://www.rallysimfans.hu/rbr/rally_online.php
  ?centerbox=rally_results_stres.php
  &rally_id={rallyId}
  &cg={carGroupId}
  &stage_no={stageNo}
```

- `rally_id` — integer, identifies the rally (e.g. `97248`).
- `cg` — car group id. Same rally page can host multiple groups; the stage HTML
  we inspected for rally `97248` exposed links for `cg=7` and `cg=111`.
- `stage_no` — 1-based. The in-page stage nav links expose the full range
  (e.g. `stage_no=1..21` for rally 97248).

Requires an authenticated session (see [auth.md](./auth.md)). Accessed anonymously
the page shows "Please login." instead of results.

## Encoding

The server sends `Content-Type: text/html` with no charset, but the HTML bytes
are **windows-1250** (Central European). Decoding as UTF-8 produces U+FFFD for
Hungarian/Czech characters (observed: `Karankamäki` → `Karankam�ki`). Always
decode response bodies with `windows-1250` via `client.readHtml(res)`.

## Stage title

Inside `table.rally_results_stres_left`, the first `<tr class="fejlec2">`
header row holds the stage title:

```html
<tr class="fejlec2"><td colspan="6" align="center">
  <b>Ouninpohja 1986 (Ouninpohja 1986) times:</b>
</td></tr>
```

Extract: text of the `<b>`, strip trailing ` times:`. The name appears twice
(display name + internal name in parentheses) on this site — kept as-is.

## Row structure

Result rows are `<tr class="paros">` or `<tr class="paratlan">` (alternating
stripe classes). Filter to result rows only by requiring a
`td.stage_results_poz` child — the same classes are reused elsewhere on the
page.

Columns (6 tds, in order):

| Index | Class                       | Content                     |
| ----- | --------------------------- | --------------------------- |
| 0     | `stage_results_poz`         | Position (integer)          |
| 1     | `stage_results_name`        | Driver + car (nested HTML)  |
| 2     | `stage_results_time`        | Stage time `m:ss.mmm`       |
| 3     | `stage_results_diff_prev`   | Diff to previous position   |
| 4     | `stage_results_diff_first`  | Diff to leader              |
| 5     | `stage_results_comment`     | Comment icon (only if any)  |

### Name cell (`td[1]`)

```html
<a href="usersstats.php?user_stats=42708" title="Stats">
  <samp><img src="images/flag/CZ.png" title="Czech Republic"> &nbsp;<b>sloofa</b></samp>
  <samp> / [MASLO] Petr Slehofer</samp>
</a>
<br>
<samp>Skoda Fabia S2000 Evo 2</samp>
```

Extract:

- **userId**: `user_stats=(\d+)` from the `<a href>`.
- **nickname**: first `<b>` text inside the `<a>`.
- **realName**: second `<samp>` inside the `<a>`, after the leading `" / "`.
  May be blank.
- **country**: `<img title="…">` on the flag (or filename from `src`).
- **car**: the `<samp>` after the `<br>` in the td.

## Comment extraction

When a row has a comment, the RSF site attaches it two ways (both carry the
same string):

1. Tooltip on row hover — `onmouseover="Tip('…')"` on the `<tr>`.
2. Icon in `td.stage_results_comment` — `<img title='…' onclick='alert("…")'>`.

Rows without a comment have no `onmouseover` attribute and an empty
`stage_results_comment` cell.

Regex: `onmouseover="Tip\('(.*?)'\)"` against the `<tr>` attribute. The value
uses single-quoted JS string literals, so embedded single quotes would be
escaped — handle unescaping if that becomes relevant.

## Stage count discovery

The stage results page itself contains a nav listing every stage of the rally
as links with `stage_no=N`. Fetch stage 1, then scan the HTML for the maximum
`stage_no=\d+` value to determine how many stages exist. No separate
endpoint is required.

## Politeness & rate limits

README note: "Parse stage count and go through all stage results in a polite
manner, not spamming the server." Observed: a 1 s delay between stage requests
gets throttled — rally 97248/cg=7 returned HTTP 429 at stage 10. `fetchAllStages`
defaults to a 3 s delay and retries 429s with exponential backoff (2 s → 4 s → …
capped by `maxRetries`, default 4), honoring `Retry-After` when present.
