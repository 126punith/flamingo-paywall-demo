import type { StorePurchase } from '@/iap/types';

import { http, withRetry } from './http';

export { ApiError } from './http';

export interface Entitlement {
  active: boolean;
  productId: string | null;
  expiresAt: string | null;
  inTrial: boolean;
  willRenew: boolean;
}

export const entitlementKeys = {
  all: ['entitlement'] as const,
};

/**
 * Safe to retry: the server keys the write by the store's transaction id, so a
 * retry after a lost response returns the same entitlement instead of a duplicate.
 */
export function verifyPurchase(purchase: StorePurchase) {
  return withRetry(async () => {
    const res = await http.post<Entitlement>('/verify', {
      platform: purchase.platform,
      productId: purchase.productId,
      transactionId: purchase.transactionId,
      purchaseToken: purchase.purchaseToken,
    });
    return res.data;
  });
}

export async function fetchEntitlement() {
  const res = await http.get<Entitlement>('/entitlement');
  return res.data;
}
