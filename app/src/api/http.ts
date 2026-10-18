import { create, isAxiosError, type InternalAxiosRequestConfig } from 'axios';

import { getSession, resetSession } from '@/auth/session';
import { API_URL } from '@/config';
import { log } from '@/debug/log';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Network failures and 5xx are worth retrying; 4xx means the request itself is wrong. */
export const isRetryableError = (error: unknown) =>
  error instanceof ApiError && (error.status === undefined || error.status >= 500);

export const http = create({
  baseURL: API_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

type TimedConfig = InternalAxiosRequestConfig & { _startedAt?: number; _sessionRetried?: boolean };

const describe = (config: TimedConfig | undefined) =>
  `${config?.method?.toUpperCase() ?? '?'} ${config?.url ?? '?'}`;
const elapsed = (config: TimedConfig | undefined) =>
  config?._startedAt ? `${Math.round(Date.now() - config._startedAt)}ms` : '?';

http.interceptors.request.use(async (config: TimedConfig) => {
  const { token } = await getSession();
  config.headers.Authorization = `Bearer ${token}`;
  config._startedAt = Date.now();
  log.debug('http', `-> ${describe(config)}`);
  return config;
});

http.interceptors.response.use(
  (response) => {
    log.debug('http', `<- ${response.status} ${describe(response.config)} (${elapsed(response.config)})`);
    return response;
  },
  async (error: unknown) => {
    if (isAxiosError<{ error?: string }>(error) && error.response) {
      const { status, data } = error.response;
      const config = error.config as TimedConfig | undefined;
      log.warn('http', `<- ${status} ${describe(config)} (${elapsed(config)})`, { error: data?.error });
      if (status === 401 && config && !config._sessionRetried) {
        log.debug('http', 'retrying once with a fresh session');
        config._sessionRetried = true;
        await resetSession();
        return http(config);
      }
      return Promise.reject(new ApiError(data?.error ?? `Request failed (${status})`, status));
    }
    const config = isAxiosError(error) ? (error.config as TimedConfig | undefined) : undefined;
    log.warn('http', `<- network error ${describe(config)} (${elapsed(config)})`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return Promise.reject(new ApiError('Could not reach the verification server.'));
  },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exponential backoff with full jitter (Stripe's recommendation), so many clients
 * retrying after an outage don't all hit the server at the same moment.
 */
export async function withRetry<T>(fn: () => Promise<T>, { attempts = 3, baseMs = 500, maxMs = 8_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof ApiError ? (e.status ?? 'network') : 'unknown';
      if (!isRetryableError(e)) {
        log.debug('retry', `not retrying (${status}): client errors are final`);
        throw e;
      }
      if (attempt >= attempts) {
        log.warn('retry', `giving up after ${attempt + 1} tries (${status})`);
        throw e;
      }
      const delay = Math.round(Math.random() * Math.min(maxMs, baseMs * 2 ** attempt));
      log.debug('retry', `attempt ${attempt + 1} failed (${status}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}
