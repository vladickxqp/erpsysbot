/**
 * Stripe Connect on this server: shops connect their own Stripe account with
 * one button instead of pasting keys. The platform's key and the secret of
 * its Connect webhook come from the server's environment, set by whoever runs
 * the server; without both, shops use their own keys as before.
 */
const env = (name: string) => (process.env[name] ?? "").trim() || null;

export const connectKey = () => env("STRIPE_CONNECT_SECRET_KEY");
export const connectWebhookSecret = () => env("STRIPE_CONNECT_WEBHOOK_SECRET");

/** Shops can connect: the key starts payments, the secret makes their results believable. */
export const connectAvailable = () => !!connectKey() && !!connectWebhookSecret();

/** The platform's share of each card payment, in percent (0 to 20; 0 when unset). */
export function connectFeePercent(): number {
  const n = Number((env("STRIPE_CONNECT_FEE_PERCENT") ?? "0").replace(",", "."));
  return Number.isFinite(n) ? Math.min(20, Math.max(0, n)) : 0;
}

/** The fee for one payment, in cents, never more than the payment. */
export const connectFeeOf = (grossCents: number): number => Math.min(grossCents, Math.round((grossCents * connectFeePercent()) / 100));
