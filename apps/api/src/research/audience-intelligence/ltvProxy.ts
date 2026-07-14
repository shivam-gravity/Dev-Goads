/**
 * Deterministic estimated-commercial-value proxy for audience-segment ranking — explicitly
 * NOT a genuine customer lifetime value computation. This platform has no per-customer
 * identity or repeat-purchase tracking anywhere (confirmed: no order history is linked
 * across multiple purchases by the same customer), so a real LTV (which requires exactly
 * that) isn't something this codebase can honestly compute. What IS available and genuinely
 * real:
 *
 * 1. Catalog average order value — real product prices from a connected Shopify/WooCommerce
 *    store (see productCatalogService.ts), when one exists.
 * 2. Historical conversion rate — this business's own real conversion-rate history from
 *    past launched campaigns (see performancePipeline.ts's normalizePerformance), when any
 *    exist.
 *
 * Both are genuinely grounded in this business's own real data; neither is an LLM guess.
 * Combined into one 0-100 score (same scale as every other Decision Engine ranking factor)
 * so segments can be ranked relative to each other — never presented as an absolute dollar
 * "lifetime value" figure, since that would overstate what this proxy actually measures.
 */

const ORDER_VALUE_CEILING_CENTS = 20_000; // $200 — order values above this fully max out their component
const CONVERSION_RATE_CEILING = 0.15; // matches campaign-learning-engine.ts's own ceiling, for consistency
const ORDER_VALUE_WEIGHT = 60;
const CONVERSION_RATE_WEIGHT = 40;

export type LtvProxyBasis = "catalog+campaign-history" | "catalog-only" | "campaign-history-only" | "insufficient-data";

export interface LtvProxyResult {
  /** Real average order value from a connected store's catalog, in cents — null when no
   * store is connected or its catalog is empty. */
  estimatedOrderValueCents: number | null;
  /** Real historical conversion rate (0-1) from this business's own past campaigns — null
   * when no prior campaign has enough data to compute one from. */
  conversionRateSignal: number | null;
  /** 0-100 combined ranking score — 0 only when there's genuinely no basis for either
   * signal (basis === "insufficient-data"), never a fabricated placeholder number. */
  score: number;
  basis: LtvProxyBasis;
}

export function computeLtvProxy(input: {
  catalogAverageOrderValueCents?: number | null;
  historicalConversionRate?: number | null;
}): LtvProxyResult {
  const hasOrderValue = typeof input.catalogAverageOrderValueCents === "number" && input.catalogAverageOrderValueCents > 0;
  const hasConversionRate = typeof input.historicalConversionRate === "number" && input.historicalConversionRate > 0;

  if (!hasOrderValue && !hasConversionRate) {
    return { estimatedOrderValueCents: null, conversionRateSignal: null, score: 0, basis: "insufficient-data" };
  }

  const orderValueComponent = hasOrderValue
    ? Math.min(input.catalogAverageOrderValueCents! / ORDER_VALUE_CEILING_CENTS, 1) * ORDER_VALUE_WEIGHT
    : 0;
  const conversionComponent = hasConversionRate
    ? Math.min(input.historicalConversionRate! / CONVERSION_RATE_CEILING, 1) * CONVERSION_RATE_WEIGHT
    : 0;

  const basis: LtvProxyBasis =
    hasOrderValue && hasConversionRate ? "catalog+campaign-history" : hasOrderValue ? "catalog-only" : "campaign-history-only";

  return {
    estimatedOrderValueCents: hasOrderValue ? Math.round(input.catalogAverageOrderValueCents!) : null,
    conversionRateSignal: hasConversionRate ? Math.round(input.historicalConversionRate! * 10000) / 10000 : null,
    score: Math.round((orderValueComponent + conversionComponent) * 100) / 100,
    basis,
  };
}
