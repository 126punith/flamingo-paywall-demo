const enabled = __DEV__ || process.env.EXPO_PUBLIC_DEBUG_LOGS === '1';

/** First 8 chars of a UUID/token: enough to match a line against the server log. */
export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-');

/** Last 8 chars of a transaction id / purchase token: their prefixes are shared, the tails are unique. */
export const ref = (id: string | null | undefined) => (id ? `…${id.slice(-8)}` : '-');

// console.log for both levels: console.warn would pop a LogBox toast on device for expected cases.
function write(level: 'DEBUG' | 'WARN', scope: string, message: string, data?: Record<string, unknown>) {
  if (!enabled) return;
  const line = `${new Date().toISOString().slice(11, 23)} ${level} [${scope}] ${message}`;
  if (data) console.log(line, data);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string, data?: Record<string, unknown>) => write('DEBUG', scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) => write('WARN', scope, message, data),
};
