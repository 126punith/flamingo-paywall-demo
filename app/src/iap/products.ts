import type { ProductSubscription, SubscriptionOffer } from 'expo-iap';

import type { BillingPeriod, Plan, TrialOffer } from './types';

/**
 * Same ids on both stores. On Google Play each is a subscription with a single
 * auto-renewing base plan; the yearly one also carries a free-trial offer.
 * On App Store Connect both live in one subscription group so users can
 * upgrade/downgrade, and the yearly one has a free-trial introductory offer.
 */
export const PRODUCT_IDS = {
  monthly: 'flamingo_premium_monthly',
  yearly: 'flamingo_premium_yearly',
} as const;

export const SUBSCRIPTION_SKUS = Object.values(PRODUCT_IDS);

export function periodFor(productId: string): BillingPeriod {
  return productId === PRODUCT_IDS.yearly ? 'year' : 'month';
}

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 } as const;

function trialLabel(days: number) {
  return `${days}-day free trial`;
}

function durationDays(unit: string | null | undefined, count: number) {
  const perUnit = UNIT_DAYS[unit as keyof typeof UNIT_DAYS] ?? 0;
  return perUnit * count;
}

/** ISO-8601 period such as "P1W" or "P7D" (Play pricing phases). */
function isoPeriodDays(iso: string) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(iso);
  if (!m) return 0;
  const [, y, mo, w, d] = m.map((v) => Number(v ?? 0));
  return y * 365 + mo * 30 + w * 7 + d;
}

/**
 * Play only returns offers the user is eligible for, so a free-trial offer
 * being present means the user can take it. A free phase has price 0.
 */
function androidTrial(offers: SubscriptionOffer[]): TrialOffer | undefined {
  for (const offer of offers) {
    const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
    const free = phases.find((p) => p.priceAmountMicros === '0');
    if (free && offer.offerTokenAndroid) {
      const days = isoPeriodDays(free.billingPeriod) * Math.max(free.billingCycleCount, 1);
      return { days, label: trialLabel(days), offerTokenAndroid: offer.offerTokenAndroid };
    }
  }
  return undefined;
}

/** iOS exposes the intro offer on the product; eligibility is checked separately. */
function iosTrial(product: Extract<ProductSubscription, { platform: 'ios' }>): TrialOffer | undefined {
  if (product.introductoryPricePaymentModeIOS !== 'free-trial') return undefined;
  const count = Number(product.introductoryPriceNumberOfPeriodsIOS ?? 1);
  const days = durationDays(product.introductoryPriceSubscriptionPeriodIOS, count);
  return days > 0 ? { days, label: trialLabel(days) } : undefined;
}

export function toPlan(product: ProductSubscription, iosTrialEligible: boolean): Plan {
  const base = {
    productId: product.id,
    period: periodFor(product.id),
    title: product.displayName ?? product.title,
    displayPrice: product.displayPrice,
    price: product.price ?? 0,
    currency: product.currency,
  };

  if (product.platform === 'android') {
    const basePlan = product.subscriptionOffers.find(
      (o) => !o.pricingPhasesAndroid?.pricingPhaseList.some((p) => p.priceAmountMicros === '0'),
    );
    return {
      ...base,
      trial: androidTrial(product.subscriptionOffers),
      baseOfferTokenAndroid: basePlan?.offerTokenAndroid ?? undefined,
    };
  }

  return { ...base, trial: iosTrialEligible ? iosTrial(product) : undefined };
}

export function sortPlans(plans: Plan[]) {
  return [...plans].sort((a, b) => (a.period === b.period ? 0 : a.period === 'year' ? -1 : 1));
}

/** Percentage saved by the yearly plan vs. paying monthly for 12 months. */
export function yearlySavingsPercent(plans: Plan[]) {
  const monthly = plans.find((p) => p.period === 'month');
  const yearly = plans.find((p) => p.period === 'year');
  if (!monthly?.price || !yearly?.price) return null;
  const pct = Math.round((1 - yearly.price / (monthly.price * 12)) * 100);
  return pct > 0 ? pct : null;
}

export function perMonthLabel(plan: Plan) {
  if (plan.period !== 'year' || !plan.price) return null;
  try {
    return `${new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.price / 12)}/mo`;
  } catch {
    return null;
  }
}
