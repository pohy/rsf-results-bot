# RSF Authentication

## Login flow

1. `GET account2.php?centerbox=bejelentkezes2`
   - Sets `PHPSESSID` + `rl_token` cookies.
   - HTML has `<input name="token_account_login" value="…">` — per-session CSRF token.

2. `POST account2_login.php` (`application/x-www-form-urlencoded`)
   - Fields: `token_account_login` (from step 1), `login=login`, `token=` (empty, distinct from CSRF token), `l_username`, `l_pass`.
   - Send `PHPSESSID` + `rl_token` from step 1.
   - **Success = HTTP 302.** Cookies rotate on the 302 itself → handle redirects manually; auto-follow drops the status signal. Bad creds re-render form at 200.

## Session verification

GET protected page (`usersstats.php?user_stats={userId}`) with jar. Logged-in page has `Log out` + `Edit account`. Unauthed shows `Please login.` + Register link (`centerbox=regisztracio`).

## Cookies

Only `PHPSESSID` + `rl_token` matter. `rl_token` rotates on most authed requests — update + re-persist jar. Single-host jar (ignore domain/path) is enough; every request targets `www.rallysimfans.hu`.

## User-Agent

No UA → `403 Forbidden`. Standard browser UA accepted.
