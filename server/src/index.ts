import { createApp } from './app.js';
import { pruneProcessedEvents } from './db.js';
import { log, short } from './log.js';

const MOCK = process.env.IAP_MOCK === '1';
const PORT = Number(process.env.PORT ?? 4000);

pruneProcessedEvents();
setInterval(() => pruneProcessedEvents(), 24 * 60 * 60 * 1000).unref();

const app = createApp({
  mock: MOCK,
  onFirstGrant: (userId, record) =>
    log.info('analytics', `purchase_success (first grant only) ${record.productId}`, { user: short(userId) }),
});

app.listen(PORT, () => {
  log.info('server', `listening on http://localhost:${PORT} (${MOCK ? 'MOCK store' : 'live store APIs'})`, {
    logLevel: process.env.LOG_LEVEL ?? (MOCK ? 'debug' : 'info'),
  });
  if (MOCK) log.warn('server', 'IAP_MOCK=1: /mock/webhook is enabled and purchases are NOT verified. Never use in production.');
});
