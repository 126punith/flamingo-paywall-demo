export type Platform = 'ios' | 'android';

export interface VerifyRequest {
  /** Always taken from the session token, never from the request body. */
  userId: string;
  platform: Platform;
  productId: string;
  /** iOS: StoreKit transaction id. */
  transactionId?: string;
  /** Android: Play purchase token. iOS: signed transaction JWS (optional). */
  purchaseToken?: string;
}

/** Normalized result of asking a store about one subscription. */
export interface SubscriptionRecord {
  platform: Platform;
  /** Stable id for the subscription across renewals (iOS originalTransactionId / Play purchase token). */
  subscriptionKey: string;
  productId: string;
  expiresAt: string | null;
  active: boolean;
  inTrial: boolean;
  willRenew: boolean;
  /** Store-side owner id (appAccountToken / obfuscatedExternalAccountId), if set at purchase. */
  storeAccountId: string | null;
  state: string;
  /**
   * When the store produced this snapshot (ms). Used so an older snapshot never
   * overwrites a newer one when notifications arrive out of order.
   */
  sourceTs: number;
}

export interface Entitlement {
  active: boolean;
  productId: string | null;
  expiresAt: string | null;
  inTrial: boolean;
  willRenew: boolean;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
