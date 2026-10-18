export type Platform = 'ios' | 'android';
export type BillingPeriod = 'month' | 'year';

export interface TrialOffer {
  /** Human readable, e.g. "7-day free trial". */
  label: string;
  days: number;
  /** Android only: offer token that must be passed to the purchase request. */
  offerTokenAndroid?: string;
}

/** Store-agnostic plan shown on the paywall. */
export interface Plan {
  productId: string;
  period: BillingPeriod;
  title: string;
  displayPrice: string;
  /** Numeric price in major units, used for savings and per-month math. */
  price: number;
  currency: string;
  /** Present only when the store reports the user is eligible. */
  trial?: TrialOffer;
  /** Android only: base plan offer token used when no trial applies. */
  baseOfferTokenAndroid?: string;
}

/** Store-agnostic purchase handed to the backend for verification. */
export interface StorePurchase {
  platform: Platform;
  productId: string;
  /** iOS transaction id (used with the App Store Server API). */
  transactionId?: string;
  /** Android purchase token, or iOS signed transaction JWS. */
  purchaseToken?: string;
  pending: boolean;
  /** Original SDK object, needed to finish the transaction. */
  raw: unknown;
}

export interface StoreError {
  code: string;
  message: string;
  userCancelled: boolean;
}

export interface StoreAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchPlans(): Promise<Plan[]>;
  /** Starts the store sheet; the result arrives through `onPurchase` / `onError`. */
  purchase(plan: Plan, opts: { userId: string; useTrial: boolean }): Promise<void>;
  finish(purchase: StorePurchase): Promise<void>;
  /** Purchases the store still considers active for this store account. */
  getActivePurchases(): Promise<StorePurchase[]>;
  onPurchase(listener: (purchase: StorePurchase) => void): () => void;
  onError(listener: (error: StoreError) => void): () => void;
  manageSubscriptions(): Promise<void>;
}
