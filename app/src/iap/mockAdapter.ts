import { Platform } from 'react-native';

import { PRODUCT_IDS } from './products';
import type { Plan, StoreAdapter, StoreError, StorePurchase } from './types';

export type MockScenario = 'success' | 'cancel' | 'pending' | 'error';

let scenario: MockScenario = 'success';
export const setMockScenario = (next: MockScenario) => {
  scenario = next;
};
export const getMockScenario = () => scenario;

const PLANS: Plan[] = [
  {
    productId: PRODUCT_IDS.yearly,
    period: 'year',
    title: 'Flamingo Premium Yearly',
    displayPrice: '$59.99',
    price: 59.99,
    currency: 'USD',
    trial: { days: 7, label: '7-day free trial' },
  },
  {
    productId: PRODUCT_IDS.monthly,
    period: 'month',
    title: 'Flamingo Premium Monthly',
    displayPrice: '$9.99',
    price: 9.99,
    currency: 'USD',
  },
];

const purchaseListeners = new Set<(p: StorePurchase) => void>();
const errorListeners = new Set<(e: StoreError) => void>();
const owned = new Map<string, StorePurchase>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embeds the account token in the receipt, like appAccountToken / obfuscatedAccountId on real stores. */
function makePurchase(productId: string, pending: boolean, accountToken: string): StorePurchase {
  const id = `mock_acct-${accountToken}_${productId}_${Date.now()}`;
  return {
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    productId,
    transactionId: id,
    purchaseToken: id,
    pending,
    raw: { id },
  };
}

const emit = (p: StorePurchase) => purchaseListeners.forEach((l) => l(p));
const emitError = (e: StoreError) => errorListeners.forEach((l) => l(e));

export const mockAdapter: StoreAdapter = {
  async connect() {
    await sleep(150);
  },

  async disconnect() {},

  async fetchPlans() {
    await sleep(400);
    return PLANS;
  },

  async purchase(plan, { userId }) {
    await sleep(900);
    switch (scenario) {
      case 'cancel':
        return emitError({ code: 'user-cancelled', message: 'Purchase cancelled', userCancelled: true });
      case 'error':
        return emitError({ code: 'network-error', message: 'Could not reach the store. Try again.', userCancelled: false });
      case 'pending': {
        // Mirrors Ask to Buy / Play pending payments: approved later, delivered via the listener.
        emit(makePurchase(plan.productId, true, userId));
        await sleep(4000);
        const approved = makePurchase(plan.productId, false, userId);
        owned.set(plan.productId, approved);
        return emit(approved);
      }
      default: {
        const p = makePurchase(plan.productId, false, userId);
        owned.set(plan.productId, p);
        return emit(p);
      }
    }
  },

  async finish() {},

  async getActivePurchases() {
    return [...owned.values()];
  },

  onPurchase(listener) {
    purchaseListeners.add(listener);
    return () => purchaseListeners.delete(listener);
  },

  onError(listener) {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
  },

  async manageSubscriptions() {
    owned.clear();
  },
};
