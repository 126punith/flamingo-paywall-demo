import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { useEntitlementStore } from '@/entitlements/store';
import { entitlementKeys, fetchEntitlement, verifyPurchase, type Entitlement } from './client';
import { queryClient } from './queryClient';

/** Writes a server-confirmed entitlement to both the query cache and the persisted store. */
export function saveEntitlement(entitlement: Entitlement) {
  queryClient.setQueryData(entitlementKeys.all, entitlement);
  useEntitlementStore.getState().setEntitlement(entitlement);
}

export const entitlementQueryOptions = () =>
  queryOptions({
    queryKey: entitlementKeys.all,
    queryFn: async () => {
      const entitlement = await fetchEntitlement();
      useEntitlementStore.getState().setEntitlement(entitlement);
      return entitlement;
    },
    initialData: () => useEntitlementStore.getState().entitlement ?? undefined,
    initialDataUpdatedAt: () => {
      const { lastVerifiedAt } = useEntitlementStore.getState();
      return lastVerifiedAt ? Date.parse(lastVerifiedAt) : undefined;
    },
  });

export const useEntitlementQuery = () => useQuery(entitlementQueryOptions());

export const useVerifyPurchaseMutation = () =>
  useMutation({
    mutationFn: verifyPurchase,
    // verifyPurchase already retries with backoff; retrying here too would multiply attempts.
    retry: false,
    onSuccess: saveEntitlement,
  });
