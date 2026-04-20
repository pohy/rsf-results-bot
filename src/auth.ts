import * as cheerio from 'cheerio';
import { CookieJar, createJar } from './cookies.js';
import { BASE, rsfFetch, readHtml } from './client.js';

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
  const token = $('input[name="token_account_login"]').attr('value');
  if (!token) {
    throw new Error('token_account_login not found on login page');
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
    login: 'login',
    // Distinct empty form field required by server; not the CSRF token above.
    token: '',
    l_username: creds.username,
    l_pass: creds.password,
  });

  const { jar: nextJar, res } = await rsfFetch(jar, LOGIN_POST, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
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
