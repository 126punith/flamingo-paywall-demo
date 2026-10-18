import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isEntitlementActive, MAX_OFFLINE_MS } from '../src/entitlements/policy.ts';
import { toPlan, yearlySavingsPercent } from '../src/iap/products.ts';

const HOUR = 3_600_000;
const now = Date.parse('2026-10-18T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const active = (expiresAt: number | null) => ({
  active: true,
  productId: 'flamingo_premium_yearly',
  expiresAt: expiresAt === null ? null : iso(expiresAt),
  inTrial: false,
  willRenew: true,
});

describe('isEntitlementActive (offline cap)', () => {
  test('recently verified, unexpired access is honored', () => {
    assert.equal(isEntitlementActive(active(now + 300 * 24 * HOUR), iso(now - HOUR), now), true);
  });

  test('a yearly sub not re-verified for over 72h is not trusted offline', () => {
    assert.equal(isEntitlementActive(active(now + 300 * 24 * HOUR), iso(now - MAX_OFFLINE_MS - 1), now), false);
  });

  test('expiry wins when it comes before the offline limit', () => {
    assert.equal(isEntitlementActive(active(now - 1), iso(now - HOUR), now), false);
  });

  test('never-verified or inactive entitlements are locked', () => {
    assert.equal(isEntitlementActive(active(now + HOUR), null, now), false);
    assert.equal(isEntitlementActive({ ...active(now + HOUR), active: false }, iso(now), now), false);
    assert.equal(isEntitlementActive(null, iso(now), now), false);
  });
});

describe('products', () => {
  const androidProduct = (id: string, offers: unknown[]) =>
    ({ platform: 'android', id, title: id, displayPrice: '$1', price: 1, currency: 'USD', subscriptionOffers: offers }) as never;

  test('Android free-trial phase becomes a trial with its offer token', () => {
    const plan = toPlan(
      androidProduct('flamingo_premium_yearly', [
        {
          offerTokenAndroid: 'trial-token',
          pricingPhasesAndroid: {
            pricingPhaseList: [
              { priceAmountMicros: '0', billingPeriod: 'P1W', billingCycleCount: 1 },
              { priceAmountMicros: '59990000', billingPeriod: 'P1Y', billingCycleCount: 0 },
            ],
          },
        },
        {
          offerTokenAndroid: 'base-token',
          pricingPhasesAndroid: { pricingPhaseList: [{ priceAmountMicros: '59990000', billingPeriod: 'P1Y', billingCycleCount: 0 }] },
        },
      ]),
      false,
    );
    assert.equal(plan.period, 'year');
    assert.deepEqual(plan.trial, { days: 7, label: '7-day free trial', offerTokenAndroid: 'trial-token' });
    assert.equal(plan.baseOfferTokenAndroid, 'base-token');
  });

  test('no trial is shown when Play returns no free phase', () => {
    const plan = toPlan(androidProduct('flamingo_premium_monthly', []), false);
    assert.equal(plan.trial, undefined);
  });

  test('iOS trial requires eligibility', () => {
    const ios = {
      platform: 'ios',
      id: 'flamingo_premium_yearly',
      title: 'Yearly',
      displayPrice: '$59.99',
      price: 59.99,
      currency: 'USD',
      introductoryPricePaymentModeIOS: 'free-trial',
      introductoryPriceNumberOfPeriodsIOS: '1',
      introductoryPriceSubscriptionPeriodIOS: 'week',
    } as never;
    assert.equal(toPlan(ios, true).trial?.days, 7);
    assert.equal(toPlan(ios, false).trial, undefined);
  });

  test('yearly savings is computed from real prices', () => {
    const plans = [
      { productId: 'm', period: 'month', title: '', displayPrice: '', price: 9.99, currency: 'USD' },
      { productId: 'y', period: 'year', title: '', displayPrice: '', price: 59.99, currency: 'USD' },
    ] as const;
    assert.equal(yearlySavingsPercent([...plans]), 50);
  });
});
