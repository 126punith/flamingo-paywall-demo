import type { Entitlement } from '@/api/client';

/**
 * How long a server-verified entitlement is honored without re-checking. Long enough
 * to ride out flights and bad networks, short enough that a refund or revocation
 * can't be dodged indefinitely by staying offline.
 */
export const MAX_OFFLINE_MS = 72 * 60 * 60 * 1000;

/**
 * The cache is only a UI hint; the server owns the entitlement. Cached access is
 * honored until whichever comes first: the subscription expiry or the offline limit.
 */
export function isEntitlementActive(
  entitlement: Entitlement | null,
  lastVerifiedAt: string | null,
  now = Date.now(),
) {
  if (!entitlement?.active || !lastVerifiedAt) return false;
  const expiresAt = entitlement.expiresAt ? Date.parse(entitlement.expiresAt) : Infinity;
  return now < Math.min(expiresAt, Date.parse(lastVerifiedAt) + MAX_OFFLINE_MS);
}
