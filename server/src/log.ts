const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

function threshold(): number {
  const configured = process.env.LOG_LEVEL as keyof typeof LEVELS | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  return process.env.IAP_MOCK === '1' ? LEVELS.debug : LEVELS.info;
}

/** First 8 chars of a UUID/token: enough to follow one user or purchase through the logs. */
export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-');

/** Last 8 chars of a transaction id / purchase token: their prefixes are shared, the tails are unique. */
export const ref = (id: string | null | undefined) => (id ? `…${id.slice(-8)}` : '-');

function write(level: Level, scope: string, message: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const time = new Date().toISOString().slice(11, 23);
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (data) out(line, JSON.stringify(data));
  else out(line);
}

export const log = {
  debug: (scope: string, message: string, data?: Record<string, unknown>) => write('debug', scope, message, data),
  info: (scope: string, message: string, data?: Record<string, unknown>) => write('info', scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) => write('warn', scope, message, data),
  error: (scope: string, message: string, data?: Record<string, unknown>) => write('error', scope, message, data),
};
