import * as cheerio from "cheerio";
import { BASE, readHtml, rsfFetch } from "./client.js";
import { type CookieJar, createJar } from "./cookies.js";

const LOGIN_PAGE = `${BASE}/rbr/account2.php?centerbox=bejelentkezes2`;
const LOGIN_POST = `${BASE}/rbr/account2_login.php`;

export interface LoginTokenResult {
  jar: CookieJar;
  token: string;
}

export async function fetchLoginToken(jar: CookieJar): Promise<LoginTokenResult> {
  const { jar: nextJar, res } = await rsfFetch(jar, LOGIN_PAGE);
  const html = await readHtml(res);
  const $ = cheerio.load(html);
  const token = $('input[name="token_account_login"]').attr("value");
  if (!token) {
    // The page structure is stable, so a missing token means prod got a
    // different page than the login form — an IP block ("cannot be fulfilled
    // from this network"), a rate-limit, or a redirect. Surface enough of the
    // actual response to tell those apart from the cron log.
    const title = $("title").text().trim() || "(no title)";
    const snippet = html.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(
      `token_account_login not found (HTTP ${res.status}, ${html.length} bytes, title="${title}"): ${snippet}`,
    );
  }
  return { jar: nextJar, token };
}

export interface Credentials {
  username: string;
  password: string;
}

export interface LoginResult {
  jar: CookieJar;
  status: number;
}

export async function submitLogin(
  jar: CookieJar,
  token: string,
  creds: Credentials,
): Promise<LoginResult> {
  const body = new URLSearchParams({
    token_account_login: token,
    login: "login",
    // Distinct empty form field required by server; not the CSRF token above.
    token: "",
    l_username: creds.username,
    l_pass: creds.password,
  });

  const { jar: nextJar, res } = await rsfFetch(jar, LOGIN_POST, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      referer: LOGIN_PAGE,
    },
    body: body.toString(),
  });

  // Success = 302 redirect. 200 means form re-rendered with error (bad creds).
  if (res.status !== 302) {
    throw new Error(`login POST did not redirect: HTTP ${res.status}`);
  }
  return { jar: nextJar, status: res.status };
}

export async function login(creds: Credentials): Promise<CookieJar> {
  const { jar: j1, token } = await fetchLoginToken(createJar());
  const { jar: j2 } = await submitLogin(j1, token, creds);
  return j2;
}
