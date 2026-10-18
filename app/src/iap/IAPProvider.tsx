import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { useEntitlementQuery, useVerifyPurchaseMutation } from '@/api/queries';
import { getUserId } from '@/auth/session';
import { restoreFromStore, syncOnLaunch } from '@/entitlements/sync';
import { track } from '@/analytics/track';
import { log, ref, short } from '@/debug/log';

import { storeAdapter } from './adapter';
import { sortPlans } from './products';
import type { Plan, StorePurchase } from './types';

export type PurchaseStatus = 'loading' | 'idle' | 'purchasing' | 'pending' | 'verifying' | 'restoring';

interface IAPContextValue {
  plans: Plan[];
  status: PurchaseStatus;
  error: string | null;
  purchase: (plan: Plan) => Promise<void>;
  /** Resolves true when an active subscription was found. */
  restore: () => Promise<boolean>;
  reloadPlans: () => Promise<void>;
  manageSubscriptions: () => Promise<void>;
  clearError: () => void;
}

const IAPContext = createContext<IAPContextValue | null>(null);

export function IAPProvider({ children }: { children: ReactNode }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<PurchaseStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: verify } = useVerifyPurchaseMutation();
  const inFlight = useRef(new Set<string>());
  useEntitlementQuery();

  const handlePurchase = useCallback(
    async (purchase: StorePurchase) => {
      const key = purchase.transactionId ?? purchase.purchaseToken ?? purchase.productId;
      log.debug('iap', 'purchase event from store', { productId: purchase.productId, ref: ref(key), pending: purchase.pending });
      if (purchase.pending) {
        log.debug('iap', 'pending (Ask to Buy / pending payment): NOT unlocking, NOT verifying');
        setStatus('pending');
        return;
      }
      if (inFlight.current.has(key)) {
        log.debug('iap', 'already verifying this transaction, duplicate event ignored', { ref: ref(key) });
        return;
      }
      inFlight.current.add(key);
      setStatus('verifying');
      try {
        const entitlement = await verify(purchase);
        log.debug('iap', 'server verified', { active: entitlement.active, inTrial: entitlement.inTrial, expiresAt: entitlement.expiresAt });
        if (!entitlement.active) throw new Error('This purchase is no longer active.');
        // Finish only after the backend has recorded it; unfinished transactions are redelivered.
        await storeAdapter.finish(purchase);
        log.debug('iap', 'transaction finished (only after server verify)', { ref: ref(key) });
        track('purchase_success', { productId: purchase.productId, inTrial: entitlement.inTrial });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Verification failed.';
        log.warn('iap', 'verify failed: transaction left UNFINISHED so the store redelivers it', { ref: ref(key), message });
        setError(message);
        track('purchase_fail', { productId: purchase.productId, stage: 'verify', message });
      } finally {
        inFlight.current.delete(key);
        setStatus('idle');
      }
    },
    [verify],
  );

  const reloadPlans = useCallback(async () => {
    setError(null);
    setStatus('loading');
    try {
      const loaded = sortPlans(await storeAdapter.fetchPlans());
      log.debug('iap', `loaded ${loaded.length} plans`, {
        plans: loaded.map((p) => `${p.productId} ${p.displayPrice}${p.trial ? ' +trial' : ''}`),
      });
      setPlans(loaded);
    } catch (e) {
      log.warn('iap', 'fetchPlans failed', { error: e instanceof Error ? e.message : String(e) });
      setError('Could not load plans from the store.');
    } finally {
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    const offPurchase = storeAdapter.onPurchase(handlePurchase);
    const offError = storeAdapter.onError((e) => {
      log.debug('iap', e.userCancelled ? 'user cancelled the store sheet' : 'store error', { code: e.code, message: e.message });
      setStatus('idle');
      if (!e.userCancelled) setError(e.message);
      track('purchase_fail', { stage: 'store', code: e.code });
    });

    let cancelled = false;
    const connected = storeAdapter.connect();
    syncOnLaunch(connected, () => cancelled);
    (async () => {
      try {
        await connected;
        log.debug('iap', 'store connected');
      } catch (e) {
        log.warn('iap', 'store connection failed', { error: e instanceof Error ? e.message : String(e) });
        if (!cancelled) setError('In-app purchases are unavailable on this device.');
        setStatus('idle');
        return;
      }
      if (cancelled) return;
      await reloadPlans();
    })();

    return () => {
      cancelled = true;
      offPurchase();
      offError();
      storeAdapter.disconnect();
    };
  }, [handlePurchase, reloadPlans]);

  const purchase = useCallback(async (plan: Plan) => {
    setError(null);
    setStatus('purchasing');
    track('purchase_start', { productId: plan.productId, trial: !!plan.trial });
    try {
      const userId = await getUserId();
      log.debug('iap', 'requesting purchase', { productId: plan.productId, useTrial: !!plan.trial, accountToken: short(userId) });
      await storeAdapter.purchase(plan, { userId, useTrial: !!plan.trial });
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Purchase could not be started.');
    }
  }, []);

  const restore = useCallback(async () => {
    setError(null);
    setStatus('restoring');
    try {
      return !!(await restoreFromStore());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
      return false;
    } finally {
      setStatus('idle');
    }
  }, []);

  const value: IAPContextValue = {
    plans,
    status,
    error,
    purchase,
    restore,
    reloadPlans,
    manageSubscriptions: storeAdapter.manageSubscriptions,
    clearError: () => setError(null),
  };

  return <IAPContext.Provider value={value}>{children}</IAPContext.Provider>;
}

export function usePurchase() {
  const ctx = useContext(IAPContext);
  if (!ctx) throw new Error('usePurchase must be used inside IAPProvider');
  return ctx;
}
