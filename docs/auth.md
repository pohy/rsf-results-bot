# RSF Authentication

## Login flow

1. `GET https://www.rallysimfans.hu/rbr/account2.php?centerbox=bejelentkezes2`
   - Server sets `PHPSESSID` and `rl_token` cookies.
   - HTML contains `<input name="token_account_login" value="…">` — per-session CSRF-like token.

2. `POST https://www.rallysimfans.hu/rbr/account2_login.php`
   - `Content-Type: application/x-www-form-urlencoded`
   - Body fields:
     - `token_account_login` — from step 1
     - `login=login`
     - `token=` — distinct empty field (not the CSRF token above)
     - `l_username`, `l_pass`
   - Must send the `PHPSESSID` + `rl_token` cookies from step 1.
   - **Success = HTTP 302.** The response rotates/issues session cookies on the 302 itself, so redirects must be handled manually; auto-follow drops the status signal needed to distinguish success vs bad credentials.
   - Bad credentials re-render the form at HTTP 200.

## Session verification

GET a protected page (we use `usersstats.php?user_stats={userId}`) with the jar.
A logged-in page contains both `Log out` and `Edit account`. Unauthed shows
`Please login.` and a Register link (`centerbox=regisztracio`).

## Cookies

Only two cookies matter: `PHPSESSID` and `rl_token`. `rl_token` rotates on most
authed requests — the stored jar must be updated and re-persisted. A single-host
cookie jar (ignoring domain/path attributes) is sufficient because every request
targets `www.rallysimfans.hu`.

## Required UA

The host returns `403 Forbidden` when no `User-Agent` is sent. A standard browser
UA is accepted.
