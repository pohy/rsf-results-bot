import { CookieJar } from './cookies.js';
import { BASE, rsfFetch } from './client.js';
import { Credentials, login } from './auth.js';
import { loadJar, saveJar } from './storage.js';

const PROFILE_URL = (userId: number) =>
  `${BASE}/rbr/usersstats.php?user_stats=${userId}`;

export interface VerifyResult {
  jar: CookieJar;
  loggedIn: boolean;
  status: number;
}

export async function verifySession(
  jar: CookieJar,
  userId: number,
): Promise<VerifyResult> {
  const { jar: nextJar, res } = await rsfFetch(jar, PROFILE_URL(userId));
  const html = await res.text();
  const loggedIn = html.includes('Log out') && html.includes('Edit account');
  return {
    jar: nextJar,
    status: res.status,
    loggedIn,
  };
}

export interface SessionConfig {
  creds: Credentials;
  userId: number;
  jarPath: string;
}

export interface EnsureResult {
  jar: CookieJar;
  source: 'disk' | 'login' | 'refreshed';
}

function jarEquals(a: CookieJar, b: CookieJar): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

async function freshLogin(
  cfg: SessionConfig,
  source: 'login' | 'refreshed',
): Promise<EnsureResult> {
  const jar = await login(cfg.creds);
  const v = await verifySession(jar, cfg.userId);
  if (!v.loggedIn) {
    throw new Error('login succeeded but session verify failed');
  }
  await saveJar(cfg.jarPath, v.jar);
  return { jar: v.jar, source };
}

export async function ensureSession(cfg: SessionConfig): Promise<EnsureResult> {
  const existing = await loadJar(cfg.jarPath);
  if (!existing || existing.size === 0) {
    return freshLogin(cfg, 'login');
  }

  const v = await verifySession(existing, cfg.userId);
  if (v.loggedIn) {
    if (!jarEquals(existing, v.jar)) {
      await saveJar(cfg.jarPath, v.jar);
    }
    return { jar: v.jar, source: 'disk' };
  }

  return freshLogin(cfg, 'refreshed');
}
