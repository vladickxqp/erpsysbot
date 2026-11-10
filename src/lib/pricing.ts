/**
 * What a sale leaves: from the net selling price down to the contribution
 * margin, in integer cents. Revenue is not profit, and neither is the gross
 * margin: what a product costs to sell (shipping, payment fees, other costs)
 * comes off before anything is earned, and the company's running costs come
 * off that again — those belong to the books, not to one product.
 *
 * Prices are net (without VAT). Where the purchase price is unknown the
 * margins are unknown too, and say so instead of pretending it was zero.
 */

export type CostBasis = {
  /** Net selling price of one unit. */
  priceCents: number;
  /** Net purchase price of one unit; null when nobody entered one. */
  purchaseCents: number | null;
  /** What shipping one unit costs the company. */
  shippingCents?: number | null;
  /** Packaging, handling, anything else per unit. */
  otherCents?: number | null;
  /** Payment provider fee: a percentage of the gross amount the customer pays, plus a fixed part. */
  feePercent?: number | null;
  feeFixedCents?: number | null;
  /** VAT rate on the sale: the fee is charged on what the customer pays, VAT included. */
  vatRate?: number | null;
};

export type Margins = {
  revenueCents: number;
  purchaseCents: number | null;
  grossMarginCents: number | null;
  grossMarginPercent: number | null;
  paymentFeeCents: number;
  shippingCents: number;
  otherCents: number;
  contributionCents: number | null;
  contributionPercent: number | null;
};

const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : null);

export function margins(basis: CostBasis): Margins {
  const revenue = Math.max(0, Math.round(basis.priceCents));
  const shipping = Math.max(0, Math.round(basis.shippingCents ?? 0));
  const other = Math.max(0, Math.round(basis.otherCents ?? 0));
  const gross = Math.round(revenue * (1 + (basis.vatRate ?? 0) / 100));
  const fee = revenue > 0 ? Math.round((gross * (basis.feePercent ?? 0)) / 100) + Math.max(0, Math.round(basis.feeFixedCents ?? 0)) : 0;
  if (basis.purchaseCents === null || basis.purchaseCents === undefined) {
    return { revenueCents: revenue, purchaseCents: null, grossMarginCents: null, grossMarginPercent: null, paymentFeeCents: fee, shippingCents: shipping, otherCents: other, contributionCents: null, contributionPercent: null };
  }
  const purchase = Math.max(0, Math.round(basis.purchaseCents));
  const grossMargin = revenue - purchase;
  const contribution = grossMargin - shipping - other - fee;
  return {
    revenueCents: revenue,
    purchaseCents: purchase,
    grossMarginCents: grossMargin,
    grossMarginPercent: percentOf(grossMargin, revenue),
    paymentFeeCents: fee,
    shippingCents: shipping,
    otherCents: other,
    contributionCents: contribution,
    contributionPercent: percentOf(contribution, revenue),
  };
}

/** The cheapest offer that can be bought, preferring the one marked preferred when prices tie. */
export function bestOffer<T extends { purchasePriceCents: number; shippingCostCents: number | null; preferred: boolean }>(offers: readonly T[]): T | null {
  let best: T | null = null;
  for (const offer of offers) {
    const cost = offer.purchasePriceCents + (offer.shippingCostCents ?? 0);
    const bestCost = best ? best.purchasePriceCents + (best.shippingCostCents ?? 0) : Infinity;
    if (cost < bestCost || (cost === bestCost && offer.preferred && !best?.preferred)) best = offer;
  }
  return best;
}
