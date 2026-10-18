import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  getUserFriendlyErrorMessage,
  initConnection,
  isEligibleForIntroOfferIOS,
  isUserCancelledError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type ProductSubscription,
  type Purchase,
} from 'expo-iap';
import { Platform } from 'react-native';

import { SUBSCRIPTION_SKUS, toPlan } from './products';
import type { StoreAdapter, StorePurchase } from './types';

function toStorePurchase(purchase: Purchase): StorePurchase {
  const isIOS = Platform.OS === 'ios';
  return {
    platform: isIOS ? 'ios' : 'android',
    productId: purchase.productId,
    transactionId: isIOS ? purchase.id : (purchase.transactionId ?? undefined),
    purchaseToken: purchase.purchaseToken ?? undefined,
    pending: purchase.purchaseState === 'pending',
    raw: purchase,
  };
}

async function iosTrialEligible(products: ProductSubscription[]) {
  const groupId = products.find(
    (p): p is Extract<ProductSubscription, { platform: 'ios' }> => p.platform === 'ios',
  )?.subscriptionGroupIdIOS;
  if (!groupId) return false;
  try {
    return await isEligibleForIntroOfferIOS(groupId);
  } catch {
    return false;
  }
}

export const nativeAdapter: StoreAdapter = {
  async connect() {
    await initConnection();
  },

  async disconnect() {
    await endConnection();
  },

  async fetchPlans() {
    const result = await fetchProducts({ skus: SUBSCRIPTION_SKUS, type: 'subs' });
    const products = (result ?? []) as ProductSubscription[];
    const eligible = Platform.OS === 'ios' ? await iosTrialEligible(products) : false;
    return products.map((p) => toPlan(p, eligible));
  },

  async purchase(plan, { userId, useTrial }) {
    const offerToken = (useTrial && plan.trial?.offerTokenAndroid) || plan.baseOfferTokenAndroid;
    await requestPurchase({
      type: 'subs',
      request: {
        // StoreKit applies an eligible introductory offer automatically.
        // appAccountToken must be a UUID; it comes back in server notifications.
        apple: { sku: plan.productId, appAccountToken: userId },
        google: {
          skus: [plan.productId],
          obfuscatedAccountId: userId,
          subscriptionOffers: offerToken ? [{ sku: plan.productId, offerToken }] : undefined,
        },
      },
    });
  },

  async finish(purchase) {
    await finishTransaction({ purchase: purchase.raw as Purchase, isConsumable: false });
  },

  async getActivePurchases() {
    const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    return purchases.filter((p) => SUBSCRIPTION_SKUS.includes(p.productId as never)).map(toStorePurchase);
  },

  onPurchase(listener) {
    const sub = purchaseUpdatedListener((p) => listener(toStorePurchase(p)));
    return () => sub.remove();
  },

  onError(listener) {
    const sub = purchaseErrorListener((error) =>
      listener({
        code: error.code ?? 'unknown',
        message: getUserFriendlyErrorMessage(error),
        userCancelled: isUserCancelledError(error),
      }),
    );
    return () => sub.remove();
  },

  async manageSubscriptions() {
    await deepLinkToSubscriptions({ packageNameAndroid: 'com.flamingo.paywalldemo' });
  },
};
