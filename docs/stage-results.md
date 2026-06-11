# Stage results page

## URL

```
rally_online.php?centerbox=rally_results_stres.php&rally_id={id}&cg={carGroup}&stage_no={n}
```

- `rally_id` — integer.
- `cg` — car group id. One rally can host multiple (e.g. `7`, `111`).
- `stage_no` — 1-based.

Needs auth session ([auth.md](./auth.md)). Anonymous → "Please login."

## Encoding

Server sends `text/html` no charset, but bytes are **windows-1250**. UTF-8 decode → U+FFFD on Hungarian/Czech chars (`Karankamäki` → `Karankam�ki`). Decode via `client.readHtml(res)`.

## Stage title

In `table.rally_results_stres_left`, first `<tr class="fejlec2">` header:

```html
<tr class="fejlec2"><td colspan="6" align="center"><b>Ouninpohja 1986 (Ouninpohja 1986) times:</b></td></tr>
```

Extract `<b>` text, strip trailing ` times:`. Name appears twice (display + internal in parens) — kept as-is.

## Row structure

Result rows: `<tr class="paros">` / `<tr class="paratlan">` (alternating stripes). Filter to rows with a `td.stage_results_poz` child — classes reused elsewhere.

6 tds in order:

| Index | Class                      | Content                    |
| ----- | -------------------------- | -------------------------- |
| 0     | `stage_results_poz`        | Position (integer)         |
| 1     | `stage_results_name`       | Driver + car (nested HTML) |
| 2     | `stage_results_time`       | Stage time `m:ss.mmm`      |
| 3     | `stage_results_diff_prev`  | Diff to previous position  |
| 4     | `stage_results_diff_first` | Diff to leader             |
| 5     | `stage_results_comment`    | Comment icon (if any)      |

### Name cell (td[1])

```html
<a href="usersstats.php?user_stats=42708" title="Stats">
  <samp><img src="images/flag/CZ.png" title="Czech Republic"> &nbsp;<b>sloofa</b></samp>
  <samp> / [MASLO] Petr Slehofer</samp>
</a>
<br>
<samp>Skoda Fabia S2000 Evo 2</samp>
```

- **userId** — `user_stats=(\d+)` from `<a href>`.
- **nickname** — first `<b>` inside `<a>`.
- **realName** — second `<samp>` inside `<a>`, after leading `" / "`. May be blank.
- **country** — flag `<img title="…">` (or filename from `src`).
- **car** — `<samp>` after the `<br>`.

## Comment extraction

Comment attached two ways (same string):

1. Row tooltip — `onmouseover="Tip('…')"` on `<tr>`.
2. Icon in `td.stage_results_comment` — `<img title='…' onclick='alert("…")'>`.

No comment → no `onmouseover`, empty comment cell. Regex `onmouseover="Tip\('(.*?)'\)"` on `<tr>`. Single-quoted JS literal — unescape embedded quotes if needed.

## Stage count discovery

Page has nav listing every stage as `stage_no=N` links. Fetch stage 1, scan for max `stage_no=\d+`. No separate endpoint.

## Politeness & rate limits

1 s delay → throttled (rally 97248/cg=7 hit HTTP 429 at stage 10). `fetchAllStages` defaults to 3 s delay, retries 429 with exponential backoff (2→4→… capped by `maxRetries`, default 4), honors `Retry-After`.
