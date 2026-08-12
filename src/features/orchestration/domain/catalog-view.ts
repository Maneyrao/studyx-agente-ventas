import { capRetrievedItems } from './retrieved-context';

/**
 * What the agent is allowed to say about price and availability.
 *
 * `.claude/rules/payments.md` is unambiguous: the model never drafts a price.
 * That rule only holds if there is exactly one shape of price data reaching the
 * prompt, and if that shape cannot represent something untrue. So:
 *
 * - An expired promotion is not "a promotion that ended". It is **absent**, and
 *   the price reverts to list. A stale discount shown as history is a discount
 *   the customer will ask for.
 * - An inactive product does not appear at all.
 * - An empty catalog sets `prices_assertable: false`, which is the signal that
 *   the agent must decline to quote instead of improvising.
 * - Descriptions are authored content, so they go through the same
 *   sanitization as any retrieved document.
 *
 * Pure and time-injected: `now` is a parameter so the promo window is testable
 * without freezing the clock.
 */

export interface CatalogSourceProduct {
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly duration_weeks: number;
  readonly modality: 'live' | 'ondemand' | 'hybrid';
  readonly price_ars_cents: number;
  readonly price_usd_cents: number;
  readonly promo_ars_cents: number | null;
  readonly promo_usd_cents: number | null;
  readonly promo_valid_to: string | null;
  readonly active: boolean;
}

export interface CatalogItemView {
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly duration_weeks: number;
  readonly modality: 'live' | 'ondemand' | 'hybrid';
  /** The one price the agent may quote. Already resolved against the clock. */
  readonly price: { readonly ars_cents: number; readonly usd_cents: number };
  readonly price_source: 'list' | 'promo';
  readonly promo: {
    readonly ars_cents: number | null;
    readonly usd_cents: number | null;
    readonly valid_to: string | null;
  } | null;
}

export interface CatalogView {
  readonly items: CatalogItemView[];
  readonly count: number;
  readonly dropped: number;
  readonly stale_promotions_dropped: number;
  readonly injection_suspected_count: number;
  readonly as_of: string;
  /** false = the agent must not state any price on this turn. */
  readonly prices_assertable: boolean;
}

export interface CatalogLimits {
  readonly maxItems: number;
  readonly maxDescriptionChars: number;
  readonly maxTotalChars: number;
}

export const DEFAULT_CATALOG_LIMITS: CatalogLimits = {
  maxItems: 20,
  maxDescriptionChars: 280,
  maxTotalChars: 6_000,
};

function promoIsLive(product: CatalogSourceProduct, now: number): boolean {
  if (product.promo_ars_cents === null && product.promo_usd_cents === null) return false;
  if (product.promo_valid_to === null) return true;
  const validTo = Date.parse(product.promo_valid_to);
  return !Number.isFinite(validTo) || validTo >= now;
}

export function buildCatalogView(
  products: readonly CatalogSourceProduct[],
  options: CatalogLimits & { now: number }
): CatalogView {
  const active = products
    .filter((product) => product.active)
    .slice()
    .sort((left, right) => left.sku.localeCompare(right.sku));

  const capped = capRetrievedItems(active, (product) => product.description ?? '', {
    maxItems: options.maxItems,
    maxCharsPerItem: options.maxDescriptionChars,
    maxTotalChars: options.maxTotalChars,
  });

  let stalePromotions = 0;

  const items = capped.kept.map(({ item: product, text }): CatalogItemView => {
    const live = promoIsLive(product, options.now);
    const hasPromoPrice = product.promo_ars_cents !== null || product.promo_usd_cents !== null;
    if (hasPromoPrice && !live) stalePromotions += 1;

    return {
      sku: product.sku,
      name: product.name,
      description: product.description === null ? null : text,
      duration_weeks: product.duration_weeks,
      modality: product.modality,
      price: {
        ars_cents: live && product.promo_ars_cents !== null
          ? product.promo_ars_cents
          : product.price_ars_cents,
        usd_cents: live && product.promo_usd_cents !== null
          ? product.promo_usd_cents
          : product.price_usd_cents,
      },
      price_source: live ? 'promo' : 'list',
      promo: live
        ? {
            ars_cents: product.promo_ars_cents,
            usd_cents: product.promo_usd_cents,
            valid_to: product.promo_valid_to,
          }
        : null,
    };
  });

  return {
    items,
    count: items.length,
    dropped: capped.dropped,
    stale_promotions_dropped: stalePromotions,
    injection_suspected_count: capped.injection_suspected_count,
    as_of: new Date(options.now).toISOString(),
    prices_assertable: items.length > 0,
  };
}
