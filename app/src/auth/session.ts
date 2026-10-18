import axios from 'axios';

import { API_URL } from '@/config';
import { log, short } from '@/debug/log';
import { secureStorage } from '@/storage/secureStorage';

export interface Session {
  userId: string;
  token: string;
}

const KEY = 'flamingo.session';
let cached: Promise<Session> | null = null;

async function load(): Promise<Session> {
  const stored = await secureStorage.getItem(KEY);
  if (stored) {
    const session = JSON.parse(stored) as Session;
    log.debug('session', 'loaded from secure storage', { user: short(session.userId) });
    return session;
  }
  log.debug('session', 'none stored, requesting /auth/anonymous', { api: API_URL });
  // Bare axios call: the shared client's interceptor needs a session to exist.
  const { data } = await axios.post<Session>(`${API_URL}/auth/anonymous`, undefined, { timeout: 15_000 });
  await secureStorage.setItem(KEY, JSON.stringify(data));
  log.debug('session', 'new session issued and stored', { user: short(data.userId) });
  return data;
}

/**
 * Server-issued anonymous session. In the real app this is the signed-in account;
 * either way the server, not the client, decides which user a request acts for.
 */
export function getSession() {
  cached ??= load().catch((e) => {
    log.warn('session', 'could not get a session', { error: e instanceof Error ? e.message : String(e) });
    cached = null;
    throw e;
  });
  return cached;
}

export const getUserId = async () => (await getSession()).userId;

/** Drops a session the server rejected (e.g. after a secret rotation) so the next call mints a new one. */
export async function resetSession() {
  log.warn('session', 'server rejected the session, discarding it');
  cached = null;
  await secureStorage.removeItem(KEY);
}
