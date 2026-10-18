import { verifyPurchase, type Entitlement } from '@/api/client';
import { entitlementQueryOptions, saveEntitlement } from '@/api/queries';
import { queryClient } from '@/api/queryClient';
import { log } from '@/debug/log';
import { storeAdapter } from '@/iap/adapter';

import { isEntitlementActive, MAX_OFFLINE_MS, useEntitlementStore } from './store';

/** Re-reads the server's view of the user's access. Keeps the cache on network errors. */
export async function refreshEntitlement() {
  try {
    const entitlement = await queryClient.fetchQuery({ ...entitlementQueryOptions(), staleTime: 0 });
    log.debug('sync', `server entitlement: ${entitlement.active ? `active ${entitlement.productId}` : 'none'}`, {
      expiresAt: entitlement.expiresAt,
    });
    return entitlement;
  } catch (e) {
    const { entitlement, lastVerifiedAt } = useEntitlementStore.getState();
    const offlineUntil = lastVerifiedAt ? new Date(Date.parse(lastVerifiedAt) + MAX_OFFLINE_MS).toISOString() : null;
    log.warn('sync', 'server unreachable, falling back to cache', {
      error: e instanceof Error ? e.message : String(e),
      cachedActive: !!entitlement?.active,
      lastVerifiedAt,
      offlineUntil,
      stillHonored: isEntitlementActive(entitlement, lastVerifiedAt),
    });
    return entitlement;
  }
}

/**
 * Sends every purchase the store account still owns to the backend and keeps the
 * best result. Covers reinstalls, new devices, and missed listener events.
 */
export async function restoreFromStore(): Promise<Entitlement | null> {
  const purchases = await storeAdapter.getActivePurchases();
  log.debug('restore', `store reports ${purchases.length} active purchase(s)`, {
    products: purchases.map((p) => p.productId),
  });
  let best: Entitlement | null = null;
  for (const purchase of purchases) {
    const result = await verifyPurchase(purchase);
    log.debug('restore', `${purchase.productId}: server says ${result.active ? 'active' : 'inactive'}`);
    if (result.active && (!best || (result.expiresAt ?? '') > (best.expiresAt ?? ''))) best = result;
  }
  if (best) saveEntitlement(best);
  log.debug('restore', best ? `restored ${best.productId}` : 'nothing to restore');
  return best;
}

/**
 * Launch sync: server first, then a silent store restore if the server has nothing.
 * The server check doesn't need the store, so it runs while the store is still connecting;
 * only the restore waits for `storeReady`.
 */
export async function syncOnLaunch(storeReady: Promise<unknown>, isCancelled: () => boolean = () => false) {
  log.debug('sync', 'launch sync: asking server (in parallel with store connection)');
  const entitlement = await refreshEntitlement();
  if (isCancelled()) return;
  if (isEntitlementActive(entitlement, useEntitlementStore.getState().lastVerifiedAt)) {
    log.debug('sync', 'launch sync: premium active, no restore needed');
    return;
  }
  log.debug('sync', 'launch sync: no active entitlement, trying silent store restore');
  try {
    await storeReady;
    if (isCancelled()) return;
    await restoreFromStore();
  } catch (e) {
    // Silent: the user can still tap "Restore Purchases" on the paywall.
    log.warn('sync', 'silent restore failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
