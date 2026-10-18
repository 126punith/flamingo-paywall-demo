import express, { type NextFunction, type Request, type Response } from 'express';

import { issueSession, requireUser } from './auth.js';
import {
  applyEventOnce,
  findOwner,
  getEntitlement,
  isEventProcessed,
  subscriptionsForUser,
  upsertSubscription,
  type UpsertResult,
} from './db.js';
import { log, ref, short } from './log.js';
import { decodeAppleNotification, verifyApple } from './stores/apple.js';
import { fetchGoogleSubscription, parseGoogleNotification, verifyGoogle, verifyPubSubPush } from './stores/google.js';
import { verifyMock } from './stores/mock.js';
import { HttpError, type SubscriptionRecord, type VerifyRequest } from './types.js';

export interface AppOptions {
  mock?: boolean;
  /** Runs exactly once per subscription, when it is first recorded (never on retries/replays). */
  onFirstGrant?: (userId: string, record: SubscriptionRecord) => void;
}

const KNOWN_PRODUCTS = new Set(
  (process.env.PRODUCT_IDS ?? 'flamingo_premium_monthly,flamingo_premium_yearly').split(','),
);

function parseVerifyRequest(body: unknown, userId: string): VerifyRequest {
  const b = (body ?? {}) as Partial<VerifyRequest>;
  if (b.platform !== 'ios' && b.platform !== 'android') throw new HttpError(400, 'platform must be ios or android');
  if (!b.productId) throw new HttpError(400, 'productId is required');
  if (!b.transactionId && !b.purchaseToken) throw new HttpError(400, 'transactionId or purchaseToken is required');
  return {
    userId,
    platform: b.platform,
    productId: b.productId,
    transactionId: b.transactionId,
    purchaseToken: b.purchaseToken,
  };
}

/** Webhooks carry no session: attribute to the existing owner, else the id embedded at purchase. */
function applyStoreSnapshot(record: SubscriptionRecord): UpsertResult | 'unowned' {
  const owner = findOwner(record.subscriptionKey) ?? record.storeAccountId;
  if (!owner) return 'unowned';
  return upsertSubscription(owner, record);
}

export function createApp({ mock = false, onFirstGrant = () => {} }: AppOptions = {}) {
  const app = express();
  // Entitlements must never come from an HTTP cache: a revoked user could keep an old "active" response.
  app.set('etag', false);
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use((req, res, next) => {
    // The Expo web build runs on another origin during the demo.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });
  app.use((req, res, next) => {
    const start = performance.now();
    res.on('finish', () => {
      const ms = Math.round(performance.now() - start);
      const user = res.locals.userId ? ` user=${short(res.locals.userId)}` : '';
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[level]('http', `${req.method} ${req.path} -> ${res.statusCode} (${ms}ms)${user}`);
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, mock });
  });

  app.post('/auth/anonymous', (_req, res) => {
    res.json(issueSession());
  });

  app.post('/verify', requireUser, async (req, res) => {
    const userId = res.locals.userId as string;
    const body = parseVerifyRequest(req.body, userId);
    log.debug('verify', 'request', {
      user: short(userId),
      platform: body.platform,
      productId: body.productId,
      ref: ref(body.transactionId ?? body.purchaseToken),
    });

    const record = mock ? verifyMock(body) : body.platform === 'ios' ? await verifyApple(body) : await verifyGoogle(body);
    log.debug('verify', `store says ${record.state}`, {
      key: record.subscriptionKey,
      active: record.active,
      inTrial: record.inTrial,
      expiresAt: record.expiresAt,
      storeAccount: short(record.storeAccountId),
    });

    if (!KNOWN_PRODUCTS.has(record.productId)) {
      log.warn('verify', 'unknown product', { productId: record.productId });
      throw new HttpError(400, 'Unknown product.');
    }
    // A receipt can only unlock the account that bought it; otherwise one paid receipt
    // could be replayed to unlock any number of accounts.
    if (record.storeAccountId && record.storeAccountId !== userId) {
      log.warn('verify', 'store account id does not match caller', {
        user: short(userId),
        storeAccount: short(record.storeAccountId),
      });
      throw new HttpError(403, 'This purchase belongs to a different account.');
    }
    const result = upsertSubscription(userId, record);
    if (result === 'owned_by_other') throw new HttpError(403, 'This purchase belongs to a different account.');
    if (result === 'created') onFirstGrant(userId, record);
    else log.debug('verify', `repeat verify (${result}): first-grant side effects skipped`);

    const entitlement = getEntitlement(userId);
    log.info('verify', `${record.productId} ${record.state} -> ${result}`, { user: short(userId), entitled: entitlement.active });
    res.json(entitlement);
  });

  app.get('/entitlement', requireUser, (_req, res) => {
    const entitlement = getEntitlement(res.locals.userId as string);
    log.debug('entitlement', entitlement.active ? `active ${entitlement.productId}` : 'none', {
      user: short(res.locals.userId),
      expiresAt: entitlement.expiresAt,
    });
    res.json(entitlement);
  });

  app.post('/webhooks/apple', async (req, res) => {
    const signedPayload = req.body?.signedPayload;
    if (typeof signedPayload !== 'string') throw new HttpError(400, 'signedPayload is required');

    const decoded = await decodeAppleNotification(signedPayload).catch((e) => {
      if (e instanceof HttpError) throw e;
      log.warn('apple', 'signature verification failed', { error: e instanceof Error ? e.message : String(e) });
      throw new HttpError(401, 'Invalid App Store signature.');
    });
    const { notification, record } = decoded;
    const eventId = notification.notificationUUID;
    if (!eventId) throw new HttpError(400, 'notificationUUID is required');
    log.debug('apple', 'notification verified', {
      eventId,
      type: notification.notificationType,
      subtype: notification.subtype,
      signedDate: notification.signedDate,
      key: record?.subscriptionKey,
    });

    const outcome = applyEventOnce(eventId, 'apple', () => (record ? applyStoreSnapshot(record) : 'ignored'));
    log.info('apple', `${notification.notificationType} ${notification.subtype ?? ''} -> ${outcome.duplicate ? 'duplicate' : outcome.result}`);
    res.sendStatus(200);
  });

  app.post('/webhooks/google', async (req, res) => {
    if (!mock) await verifyPubSubPush(req.header('authorization'));
    const event = parseGoogleNotification(req.body);
    // Ack malformed messages so Pub/Sub stops retrying something we can never process.
    if (!event) {
      log.warn('google', 'malformed Pub/Sub message, acked and dropped');
      return void res.sendStatus(200);
    }
    // Fast path: skip the Play API call for redeliveries.
    if (isEventProcessed(event.messageId)) {
      log.debug('google', 'redelivery, skipped before Play API call', { messageId: event.messageId });
      return void res.sendStatus(200);
    }

    if (!event.purchaseToken) {
      log.debug('google', 'no subscription in message (test or other type), ignored', { messageId: event.messageId });
      applyEventOnce(event.messageId, 'google', () => 'ignored');
      return void res.sendStatus(200);
    }

    // RTDN only says "something changed"; the API is the source of the new state.
    // Fetched outside the transaction: no network calls while holding the write lock.
    const { record } = await fetchGoogleSubscription(event.purchaseToken);
    log.debug('google', `Play API says ${record.state}`, {
      messageId: event.messageId,
      type: event.notificationType,
      active: record.active,
      expiresAt: record.expiresAt,
    });
    const outcome = applyEventOnce(event.messageId, 'google', () => applyStoreSnapshot(record));
    log.info('google', `type=${event.notificationType} ${record.productId} ${record.state} -> ${outcome.duplicate ? 'duplicate' : outcome.result}`);
    res.sendStatus(200);
  });

  if (mock) {
    /**
     * MOCK ONLY. Simulates a signed store notification for every subscription of `userId`:
     * `{ eventId, userId, event: "refund" | "expire" | "renew", signedAt?, failAfterLedger? }`.
     * `signedAt` lets tests send out-of-order snapshots; `failAfterLedger` simulates a crash
     * mid-processing to show the ledger row is rolled back.
     */
    app.post('/mock/webhook', (req, res) => {
      const { eventId, userId, event, signedAt, failAfterLedger } = req.body ?? {};
      if (!eventId || !userId) throw new HttpError(400, 'eventId and userId are required');
      if (!['refund', 'expire', 'renew'].includes(event)) throw new HttpError(400, 'event must be refund, expire, or renew');
      const sourceTs = typeof signedAt === 'number' ? signedAt : Date.now();
      const renew = event === 'renew';

      const outcome = applyEventOnce(eventId, 'mock', () => {
        const results = subscriptionsForUser(userId).map(({ subscriptionKey, productId }) =>
          upsertSubscription(userId, {
            platform: 'ios',
            subscriptionKey,
            productId,
            expiresAt: new Date(renew ? sourceTs + 30 * 86_400_000 : sourceTs).toISOString(),
            active: renew,
            inTrial: false,
            willRenew: renew,
            storeAccountId: null,
            state: event === 'refund' ? 'REVOKED' : renew ? 'ACTIVE' : 'EXPIRED',
            sourceTs,
          }),
        );
        if (failAfterLedger) throw new Error('Simulated crash while processing notification');
        return results;
      });

      log.info('mock', `${event} ${eventId} -> ${outcome.duplicate ? 'duplicate' : outcome.result.join(',') || 'no subscriptions'}`, {
        user: short(userId),
      });
      res.json({
        duplicate: outcome.duplicate,
        results: outcome.duplicate ? [] : outcome.result,
        entitlement: getEntitlement(userId),
      });
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'Unexpected error';
    if (status >= 500) console.error(err);
    else log.debug('error', `${status} ${message}`);
    res.status(status).json({ error: status === 502 ? 'Store verification failed. Try again.' : message });
  });

  return app;
}
