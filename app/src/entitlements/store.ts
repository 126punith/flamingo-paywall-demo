import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Entitlement } from '@/api/client';
import { log } from '@/debug/log';
import { secureStorage } from '@/storage/secureStorage';

import { isEntitlementActive } from './policy';

interface EntitlementState {
  entitlement: Entitlement | null;
  lastVerifiedAt: string | null;
  setEntitlement: (entitlement: Entitlement) => void;
  clear: () => void;
}

export const useEntitlementStore = create<EntitlementState>()(
  persist(
    (set) => ({
      entitlement: null,
      lastVerifiedAt: null,
      setEntitlement: (entitlement) => {
        log.debug('cache', `saved server entitlement: ${entitlement.active ? `active ${entitlement.productId}` : 'none'}`);
        set({ entitlement, lastVerifiedAt: new Date().toISOString() });
      },
      clear: () => set({ entitlement: null, lastVerifiedAt: null }),
    }),
    {
      name: 'flamingo.entitlement',
      storage: createJSONStorage(() => secureStorage),
      partialize: ({ entitlement, lastVerifiedAt }) => ({ entitlement, lastVerifiedAt }),
      onRehydrateStorage: () => (state) =>
        log.debug('cache', 'loaded from secure storage', {
          cachedActive: !!state?.entitlement?.active,
          lastVerifiedAt: state?.lastVerifiedAt ?? null,
          honoredNow: isEntitlementActive(state?.entitlement ?? null, state?.lastVerifiedAt ?? null),
        }),
    },
  ),
);

/** True once the cached entitlement has been read from secure storage. */
export const useEntitlementHydrated = () =>
  useSyncExternalStore(useEntitlementStore.persist.onFinishHydration, useEntitlementStore.persist.hasHydrated);

export { isEntitlementActive, MAX_OFFLINE_MS } from './policy';

export const useIsPremium = () => useEntitlementStore((s) => isEntitlementActive(s.entitlement, s.lastVerifiedAt));
