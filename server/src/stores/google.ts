import { androidpublisher, auth, type androidpublisher_v3 } from '@googleapis/androidpublisher';
import { OAuth2Client } from 'google-auth-library';

import { log } from '../log.js';
import type { SubscriptionRecord, VerifyRequest } from '../types.js';
import { HttpError } from '../types.js';

let api: androidpublisher_v3.Androidpublisher | null = null;
const oidc = new OAuth2Client();

function packageName() {
  const name = process.env.GOOGLE_PACKAGE_NAME;
  if (!name) throw new HttpError(500, 'Server is missing GOOGLE_PACKAGE_NAME');
  return name;
}

function getApi() {
  if (!api) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    if (!keyFile) throw new HttpError(500, 'Server is missing GOOGLE_SERVICE_ACCOUNT_KEY_PATH');
    const client = new auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
    api = androidpublisher({ version: 'v3', auth: client });
  }
  return api;
}

/** States in which the user keeps access. CANCELED means "won't renew" but is paid until expiry. */
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

export async function fetchGoogleSubscription(purchaseToken: string) {
  // Taken before the call: a fetch that starts later always sees newer (or equal) Play state.
  const fetchedAt = Date.now();
  const { data } = await getApi().purchases.subscriptionsv2.get({ packageName: packageName(), token: purchaseToken });
  return {
    record: toRecord(purchaseToken, data, fetchedAt),
    acknowledged: data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING',
  };
}

function toRecord(
  purchaseToken: string,
  data: androidpublisher_v3.Schema$SubscriptionPurchaseV2,
  sourceTs: number,
): SubscriptionRecord {
  const item = [...(data.lineItems ?? [])].sort((a, b) => (b.expiryTime ?? '').localeCompare(a.expiryTime ?? ''))[0];
  const expiresAt = item?.expiryTime ?? null;
  // SUBSCRIPTION_STATE_PENDING is deliberately not entitled: no access until Play confirms payment.
  const state = data.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED';
  const notExpired = !expiresAt || new Date(expiresAt).getTime() > Date.now();

  return {
    platform: 'android',
    // On upgrade/downgrade Play issues a new token and sets linkedPurchaseToken to the old one.
    subscriptionKey: `android:${purchaseToken}`,
    productId: item?.productId ?? '',
    expiresAt,
    active: ENTITLED_STATES.has(state) && notExpired,
    inTrial: !!item?.offerPhase?.freeTrial,
    willRenew: !!item?.autoRenewingPlan?.autoRenewEnabled,
    storeAccountId: data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    state,
    sourceTs,
  };
}

export async function verifyGoogle(req: VerifyRequest): Promise<SubscriptionRecord> {
  if (!req.purchaseToken) throw new HttpError(400, 'purchaseToken is required for Android');
  const { record, acknowledged } = await fetchGoogleSubscription(req.purchaseToken);

  // Unacknowledged purchases are refunded by Play after 3 days. Pending ones are never active, so never acked.
  if (record.active && !acknowledged) {
    try {
      await getApi().purchases.subscriptions.acknowledge({
        packageName: packageName(),
        subscriptionId: record.productId,
        token: req.purchaseToken,
      });
      log.debug('google', 'acknowledged purchase', { productId: record.productId });
    } catch (e) {
      // A concurrent /verify may have acknowledged first; only fail if it is still unacknowledged.
      const again = await fetchGoogleSubscription(req.purchaseToken);
      if (!again.acknowledged) throw e;
      log.debug('google', 'acknowledge failed but purchase is already acknowledged, treated as success');
    }
  } else {
    log.debug('google', 'acknowledge skipped', { active: record.active, alreadyAcknowledged: acknowledged });
  }
  return record;
}

export interface GoogleNotification {
  messageId: string;
  purchaseToken: string | null;
  notificationType: number | null;
}

/** Play RTDN via Pub/Sub push: `{ message: { data: base64(JSON), messageId } }`. */
export function parseGoogleNotification(body: unknown): GoogleNotification | null {
  const message = (body as { message?: { data?: string; messageId?: string; message_id?: string } })?.message;
  const messageId = message?.messageId ?? message?.message_id;
  if (!message?.data || !messageId) return null;
  const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  const sub = decoded.subscriptionNotification;
  return { messageId, purchaseToken: sub?.purchaseToken ?? null, notificationType: sub?.notificationType ?? null };
}

/**
 * Pub/Sub push subscriptions with authentication send a Google-signed OIDC token.
 * Without this check anyone could POST fake RTDNs (harmless state-wise, since we
 * re-fetch from Play, but it would burn API quota).
 */
export async function verifyPubSubPush(authorization: string | undefined) {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const expectedEmail = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT;
  if (!audience || !expectedEmail) throw new HttpError(500, 'Server is missing Pub/Sub push auth config');
  const [scheme, idToken] = (authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !idToken) throw new HttpError(401, 'Missing Pub/Sub token');
  try {
    const ticket = await oidc.verifyIdToken({ idToken, audience });
    const claims = ticket.getPayload();
    if (claims?.email !== expectedEmail || !claims.email_verified) throw new Error('unexpected identity');
  } catch {
    throw new HttpError(401, 'Invalid Pub/Sub token');
  }
}
