export type PaywallEvent =
  | 'paywall_view'
  | 'plan_select'
  | 'purchase_start'
  | 'purchase_success'
  | 'purchase_fail'
  | 'restore_tap';

/** Swap for Amplitude/Mixpanel/PostHog; event names are the funnel contract. */
export function track(event: PaywallEvent, props: Record<string, unknown> = {}) {
  if (__DEV__) console.log(`[analytics] ${event}`, props);
}
