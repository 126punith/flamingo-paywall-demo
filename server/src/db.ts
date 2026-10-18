import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { log, short } from './log.js';
import type { Entitlement, SubscriptionRecord } from './types.js';

const db = new DatabaseSync(process.env.DB_PATH ?? ':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_key TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    platform         TEXT NOT NULL,
    product_id       TEXT NOT NULL,
    expires_at       TEXT,
    active           INTEGER NOT NULL,
    in_trial         INTEGER NOT NULL,
    will_renew       INTEGER NOT NULL,
    state            TEXT NOT NULL,
    source_ts        INTEGER NOT NULL,
    insert_id        TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions(user_id);

  -- Ledger of store notifications already applied (Apple notificationUUID, Pub/Sub messageId).
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id    TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
`);

interface Row {
  subscription_key: string;
  user_id: string;
  product_id: string;
  expires_at: string | null;
  active: number;
  in_trial: number;
  will_renew: number;
  source_ts: number;
}

export type UpsertResult = 'created' | 'updated' | 'stale' | 'owned_by_other';

/**
 * Single-statement write, so ownership and ordering are decided atomically:
 * - a row owned by another user is never touched (receipt replay protection);
 * - a snapshot older than the stored one is ignored (out-of-order delivery);
 * - replaying the same snapshot rewrites identical values (idempotent).
 */
export function upsertSubscription(userId: string, record: SubscriptionRecord): UpsertResult {
  const now = new Date().toISOString();
  const insertId = randomUUID();
  const row = db
    .prepare(
      `INSERT INTO subscriptions
         (subscription_key, user_id, platform, product_id, expires_at, active, in_trial, will_renew,
          state, source_ts, insert_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subscription_key) DO UPDATE SET
         product_id = excluded.product_id,
         expires_at = excluded.expires_at,
         active     = excluded.active,
         in_trial   = excluded.in_trial,
         will_renew = excluded.will_renew,
         state      = excluded.state,
         source_ts  = excluded.source_ts,
         updated_at = excluded.updated_at
       WHERE subscriptions.user_id = excluded.user_id
         AND excluded.source_ts >= subscriptions.source_ts
       RETURNING insert_id`,
    )
    .get(
      record.subscriptionKey,
      userId,
      record.platform,
      record.productId,
      record.expiresAt,
      record.active ? 1 : 0,
      record.inTrial ? 1 : 0,
      record.willRenew ? 1 : 0,
      record.state,
      record.sourceTs,
      insertId,
      now,
      now,
    ) as { insert_id: string } | undefined;

  const sub = { key: record.subscriptionKey, user: short(userId), state: record.state, active: record.active };
  if (row) {
    const result = row.insert_id === insertId ? 'created' : 'updated';
    log.debug('db', `upsert ${result}`, { ...sub, sourceTs: record.sourceTs });
    return result;
  }
  const stored = db
    .prepare('SELECT user_id, source_ts FROM subscriptions WHERE subscription_key = ?')
    .get(record.subscriptionKey) as Pick<Row, 'user_id' | 'source_ts'>;
  if (stored.user_id === userId) {
    log.debug('db', 'upsert stale: stored snapshot is newer, ignored', {
      ...sub,
      incomingTs: record.sourceTs,
      storedTs: stored.source_ts,
    });
    return 'stale';
  }
  log.warn('db', 'upsert rejected: subscription owned by another user', { ...sub, owner: short(stored.user_id) });
  return 'owned_by_other';
}

/** Owner of a subscription, so webhooks (which carry no session) can be attributed. */
export function findOwner(subscriptionKey: string): string | null {
  const row = db.prepare('SELECT user_id FROM subscriptions WHERE subscription_key = ?').get(subscriptionKey) as
    | Pick<Row, 'user_id'>
    | undefined;
  return row?.user_id ?? null;
}

export function subscriptionsForUser(userId: string): { subscriptionKey: string; productId: string }[] {
  const rows = db
    .prepare('SELECT subscription_key, product_id FROM subscriptions WHERE user_id = ?')
    .all(userId) as unknown as Pick<Row, 'subscription_key' | 'product_id'>[];
  return rows.map((r) => ({ subscriptionKey: r.subscription_key, productId: r.product_id }));
}

export function countSubscriptions(userId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?').get(userId) as { n: number };
  return row.n;
}

/** Cheap pre-check so duplicates don't trigger store API calls; the transaction below is authoritative. */
export function isEventProcessed(eventId: string): boolean {
  return !!db.prepare('SELECT 1 FROM processed_events WHERE event_id = ?').get(eventId);
}

/**
 * Records `eventId` and runs `apply` in one transaction. A duplicate delivery is a
 * no-op; if `apply` throws, the ledger row is rolled back so the store's retry is processed.
 * `apply` must be synchronous: no awaits inside the transaction.
 */
export function applyEventOnce<T>(
  eventId: string,
  source: string,
  apply: () => T,
): { duplicate: true } | { duplicate: false; result: T } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const inserted = db
      .prepare('INSERT INTO processed_events (event_id, source, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(eventId, source, new Date().toISOString());
    if (inserted.changes === 0) {
      db.exec('COMMIT');
      log.debug('ledger', 'duplicate event, skipped', { eventId, source });
      return { duplicate: true };
    }
    const result = apply();
    db.exec('COMMIT');
    log.debug('ledger', 'event applied and committed', { eventId, source });
    return { duplicate: false, result };
  } catch (e) {
    db.exec('ROLLBACK');
    log.warn('ledger', 'processing failed, rolled back (store will retry)', {
      eventId,
      source,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** Apple retries for ~6.5 days (1, 12, 24, 48, 72h); 30 days leaves a wide margin. */
export function pruneProcessedEvents(maxAgeDays = 30) {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const { changes } = db.prepare('DELETE FROM processed_events WHERE received_at < ?').run(cutoff);
  log.debug('ledger', 'pruned old events', { removed: Number(changes), olderThanDays: maxAgeDays });
}

export function getEntitlement(userId: string, now = new Date()): Entitlement {
  const rows = db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ? AND active = 1 ORDER BY expires_at DESC')
    .all(userId) as unknown as Row[];
  const row = rows.find((r) => !r.expires_at || new Date(r.expires_at) > now);
  if (!row) return { active: false, productId: null, expiresAt: null, inTrial: false, willRenew: false };
  return {
    active: true,
    productId: row.product_id,
    expiresAt: row.expires_at,
    inTrial: !!row.in_trial,
    willRenew: !!row.will_renew,
  };
}
