import type { SubscriptionRecord, VerifyRequest } from '../types.js';
import { HttpError } from '../types.js';

const DAY = 24 * 60 * 60 * 1000;

/** Trusts the client payload. Only for local demos; never enable in production. */
export function verifyMock(req: VerifyRequest): SubscriptionRecord {
  const receipt = req.transactionId ?? req.purchaseToken;
  if (!receipt?.startsWith('mock_')) throw new HttpError(400, 'Mock mode only accepts mock_ purchases.');

  // `mock_acct-<userId>_...` stands in for appAccountToken / obfuscatedAccountId set at purchase time.
  const storeAccountId = /^mock_acct-([0-9a-f-]{36})_/.exec(receipt)?.[1] ?? null;
  const yearly = req.productId.includes('yearly');
  const inTrial = yearly;
  const days = inTrial ? 7 : yearly ? 365 : 30;

  return {
    platform: req.platform,
    // Keyed by the receipt, like originalTransactionId / purchaseToken, so ownership checks are real.
    subscriptionKey: `mock:${receipt}`,
    productId: req.productId,
    expiresAt: new Date(Date.now() + days * DAY).toISOString(),
    active: true,
    inTrial,
    willRenew: true,
    storeAccountId,
    state: inTrial ? 'TRIAL' : 'ACTIVE',
    sourceTs: Date.now(),
  };
}
