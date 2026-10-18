import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AppStoreServerAPIClient,
  AutoRenewStatus,
  Environment,
  OfferType,
  SignedDataVerifier,
  Status,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

import type { SubscriptionRecord, VerifyRequest } from '../types.js';
import { HttpError } from '../types.js';

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new HttpError(500, `Server is missing ${name}`);
  return value;
}

let client: AppStoreServerAPIClient | null = null;
let verifier: SignedDataVerifier | null = null;

function environment() {
  return process.env.APPLE_ENVIRONMENT === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

function getClient() {
  client ??= new AppStoreServerAPIClient(
    readFileSync(env('APPLE_PRIVATE_KEY_PATH'), 'utf8'),
    env('APPLE_KEY_ID'),
    env('APPLE_ISSUER_ID'),
    env('APPLE_BUNDLE_ID'),
    environment(),
  );
  return client;
}

/** Verifies Apple's signature chain on every JWS before trusting its contents. */
function getVerifier() {
  if (!verifier) {
    const dir = env('APPLE_ROOT_CERTS_DIR');
    const roots = readdirSync(dir)
      .filter((f) => f.endsWith('.cer'))
      .map((f) => readFileSync(join(dir, f)));
    const appAppleId = process.env.APPLE_APP_APPLE_ID ? Number(process.env.APPLE_APP_APPLE_ID) : undefined;
    verifier = new SignedDataVerifier(roots, true, environment(), env('APPLE_BUNDLE_ID'), appAppleId);
  }
  return verifier;
}

function toRecord(
  tx: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  status: Status | number | undefined,
  sourceTs: number,
): SubscriptionRecord {
  const now = Date.now();
  const graceUntil = renewal?.gracePeriodExpiresDate;
  const expiresMs = Math.max(tx.expiresDate ?? 0, status === Status.BILLING_GRACE_PERIOD ? (graceUntil ?? 0) : 0);
  const revoked = !!tx.revocationDate || status === Status.REVOKED;
  const active =
    !revoked &&
    (status === Status.ACTIVE || status === Status.BILLING_GRACE_PERIOD || (status === undefined && expiresMs > now));

  return {
    platform: 'ios',
    subscriptionKey: `ios:${tx.originalTransactionId}`,
    productId: tx.productId ?? '',
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : null,
    active,
    inTrial: tx.offerType === OfferType.INTRODUCTORY_OFFER && tx.price === 0,
    willRenew: renewal?.autoRenewStatus === AutoRenewStatus.ON,
    storeAccountId: tx.appAccountToken ?? null,
    state: revoked ? 'REVOKED' : (Status[status as Status] ?? 'UNKNOWN'),
    sourceTs,
  };
}

/** Apple signs API responses at request time, so the newest signedDate is the freshest snapshot. */
const signedAt = (...payloads: ({ signedDate?: number } | null)[]) =>
  Math.max(0, ...payloads.map((p) => p?.signedDate ?? 0)) || Date.now();

export async function verifyApple(req: VerifyRequest): Promise<SubscriptionRecord> {
  if (!req.transactionId) throw new HttpError(400, 'transactionId is required for iOS');
  const api = getClient();
  const jws = getVerifier();

  // Ask Apple directly instead of trusting the client's copy of the transaction.
  const info = await api.getTransactionInfo(req.transactionId);
  if (!info.signedTransactionInfo) throw new HttpError(404, 'Transaction not found');
  const tx = await jws.verifyAndDecodeTransaction(info.signedTransactionInfo);

  // Subscription status gives the latest renewal state for the whole group (upgrades, grace period).
  const statuses = await api.getAllSubscriptionStatuses(req.transactionId);
  for (const group of statuses.data ?? []) {
    for (const last of group.lastTransactions ?? []) {
      if (last.originalTransactionId !== tx.originalTransactionId || !last.signedTransactionInfo) continue;
      const latest = await jws.verifyAndDecodeTransaction(last.signedTransactionInfo);
      const renewal = last.signedRenewalInfo ? await jws.verifyAndDecodeRenewalInfo(last.signedRenewalInfo) : null;
      return toRecord(latest, renewal, last.status, signedAt(latest, renewal));
    }
  }
  return toRecord(tx, null, undefined, signedAt(tx));
}

/** App Store Server Notifications V2: body is `{ signedPayload }`. */
export async function decodeAppleNotification(signedPayload: string): Promise<{
  notification: ResponseBodyV2DecodedPayload;
  record: SubscriptionRecord | null;
}> {
  const jws = getVerifier();
  const notification = await jws.verifyAndDecodeNotification(signedPayload);
  const data = notification.data;
  if (!data?.signedTransactionInfo) return { notification, record: null };
  const tx = await jws.verifyAndDecodeTransaction(data.signedTransactionInfo);
  const renewal = data.signedRenewalInfo ? await jws.verifyAndDecodeRenewalInfo(data.signedRenewalInfo) : null;
  // signedDate is unchanged on retries; Apple says the newest one holds the latest state.
  return { notification, record: toRecord(tx, renewal, data.status, notification.signedDate ?? signedAt(tx, renewal)) };
}
