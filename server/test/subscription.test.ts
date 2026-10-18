import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { countSubscriptions } from '../src/db.js';

process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL ??= 'silent';

const firstGrants: string[] = [];
let base = '';
let close: () => void;

before(async () => {
  const app = createApp({ mock: true, onFirstGrant: (_userId, record) => firstGrants.push(record.subscriptionKey) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

let seq = 0;
const receipt = () => `mock_flamingo_premium_yearly_${Date.now()}_${seq++}`;

async function call(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function session(): Promise<{ userId: string; token: string }> {
  return (await call('POST', '/auth/anonymous')).body;
}

const verify = (token: string, transactionId: string, productId = 'flamingo_premium_yearly') =>
  call('POST', '/verify', { token, body: { platform: 'ios', productId, transactionId } });

const entitlement = async (token: string) => (await call('GET', '/entitlement', { token })).body;

const webhook = (body: Record<string, unknown>) => call('POST', '/mock/webhook', { body });

describe('authentication', () => {
  test('verify without a session is rejected', async () => {
    assert.equal((await call('POST', '/verify', { body: { platform: 'ios', productId: 'x', transactionId: 'y' } })).status, 401);
  });

  test('a forged or tampered token is rejected', async () => {
    const a = await session();
    const b = await session();
    const [header, , sigB] = b.token.split('.');
    const [, payloadA] = a.token.split('.');
    assert.equal((await call('GET', '/entitlement', { token: `${header}.${payloadA}.${sigB}` })).status, 401);
    assert.equal((await call('GET', '/entitlement', { token: 'not-a-token' })).status, 401);
  });

  test('a client-supplied userId in the body is ignored', async () => {
    const a = await session();
    const b = await session();
    const res = await call('POST', '/verify', {
      token: b.token,
      body: { userId: a.userId, platform: 'ios', productId: 'flamingo_premium_yearly', transactionId: receipt() },
    });
    assert.equal(res.status, 200);
    assert.equal((await entitlement(b.token)).active, true);
    assert.equal((await entitlement(a.token)).active, false);
  });
});

describe('verify', () => {
  test('a successful purchase unlocks premium', async () => {
    const u = await session();
    const res = await verify(u.token, receipt());
    assert.equal(res.status, 200);
    assert.equal(res.body.active, true);
    assert.equal(res.body.inTrial, true);
    assert.equal((await entitlement(u.token)).active, true);
  });

  test('unknown products are rejected', async () => {
    const u = await session();
    assert.equal((await verify(u.token, receipt(), 'free_money')).status, 400);
  });

  test('repeating verify is idempotent: one row, same result, one first-grant side effect', async () => {
    const u = await session();
    const r = receipt();
    const first = await verify(u.token, r);
    const again = await verify(u.token, r);
    assert.deepEqual({ ...again.body, expiresAt: null }, { ...first.body, expiresAt: null });
    assert.equal(countSubscriptions(u.userId), 1);
    assert.equal(firstGrants.filter((k) => k === `mock:${r}`).length, 1);
  });

  test('10 parallel verifies for the same purchase leave one consistent row', async () => {
    const u = await session();
    const r = receipt();
    const results = await Promise.all(Array.from({ length: 10 }, () => verify(u.token, r)));
    assert.ok(results.every((x) => x.status === 200 && x.body.active));
    assert.equal(countSubscriptions(u.userId), 1);
    assert.equal(firstGrants.filter((k) => k === `mock:${r}`).length, 1);
  });

  test('entitlement responses are never cacheable', async () => {
    const u = await session();
    const res = await fetch(`${base}/entitlement`, { headers: { Authorization: `Bearer ${u.token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('etag'), null);
  });

  test('a receipt bound to user A at purchase time is rejected for user B', async () => {
    const a = await session();
    const b = await session();
    const bound = `mock_acct-${a.userId}_flamingo_premium_yearly_${Date.now()}_${seq++}`;
    const res = await verify(b.token, bound);
    assert.equal(res.status, 403);
    assert.equal(countSubscriptions(b.userId), 0);
    assert.equal((await verify(a.token, bound)).status, 200);
  });

  test("user B cannot claim user A's receipt, even concurrently", async () => {
    const a = await session();
    const b = await session();
    const r = receipt();
    const [ra, rb] = await Promise.all([verify(a.token, r), verify(b.token, r)]);
    const statuses = [ra.status, rb.status].sort();
    assert.deepEqual(statuses, [200, 403]);
    const winner = ra.status === 200 ? a : b;
    const loser = winner === a ? b : a;
    assert.equal((await entitlement(winner.token)).active, true);
    assert.equal((await entitlement(loser.token)).active, false);
    assert.equal((await verify(loser.token, r)).status, 403);
  });
});

describe('notifications', () => {
  test('refund locks access; expire too', async () => {
    const u = await session();
    await verify(u.token, receipt());
    const res = await webhook({ eventId: `evt_${seq++}`, userId: u.userId, event: 'refund' });
    assert.equal(res.status, 200);
    assert.equal(res.body.entitlement.active, false);

    const v = await session();
    await verify(v.token, receipt());
    await webhook({ eventId: `evt_${seq++}`, userId: v.userId, event: 'expire' });
    assert.equal((await entitlement(v.token)).active, false);
  });

  test('a duplicate notification id is processed once', async () => {
    const u = await session();
    await verify(u.token, receipt());
    const refundId = `evt_${seq++}`;
    const t = Date.now();
    await webhook({ eventId: refundId, userId: u.userId, event: 'refund', signedAt: t });
    await webhook({ eventId: `evt_${seq++}`, userId: u.userId, event: 'renew', signedAt: t + 1000 });
    assert.equal((await entitlement(u.token)).active, true);

    // Same id redelivered. Even with a newer timestamp it must not be applied again.
    const dup = await webhook({ eventId: refundId, userId: u.userId, event: 'refund', signedAt: t + 2000 });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    assert.equal((await entitlement(u.token)).active, true);
  });

  test('an older snapshot arriving late does not overwrite a newer one', async () => {
    const u = await session();
    await verify(u.token, receipt());
    const t = Date.now() + 1000;
    await webhook({ eventId: `evt_${seq++}`, userId: u.userId, event: 'refund', signedAt: t });
    const late = await webhook({ eventId: `evt_${seq++}`, userId: u.userId, event: 'renew', signedAt: t - 60_000 });
    assert.deepEqual(late.body.results, ['stale']);
    assert.equal((await entitlement(u.token)).active, false);
  });

  test('a crash mid-processing rolls back the ledger so the retry is applied', async () => {
    const u = await session();
    await verify(u.token, receipt());
    const id = `evt_${seq++}`;
    const crashed = await webhook({ eventId: id, userId: u.userId, event: 'refund', failAfterLedger: true });
    assert.ok(crashed.status >= 500);
    assert.equal((await entitlement(u.token)).active, true);

    const retried = await webhook({ eventId: id, userId: u.userId, event: 'refund' });
    assert.equal(retried.body.duplicate, false);
    assert.equal((await entitlement(u.token)).active, false);
  });

  test('relaunch: entitlement is served from the server, not the client', async () => {
    const u = await session();
    await verify(u.token, receipt());
    assert.equal((await entitlement(u.token)).active, true);
    await webhook({ eventId: `evt_${seq++}`, userId: u.userId, event: 'refund' });
    assert.equal((await entitlement(u.token)).active, false);
  });
});
