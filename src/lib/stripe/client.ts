import Stripe from "stripe";

// Lazily constructed so a missing STRIPE_SECRET_KEY doesn't crash the
// build/import — it only throws when an actual Stripe call is attempted,
// which is the moment it's genuinely needed.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add your real Stripe secret key (test mode is fine to start) as an environment variable in Vercel/Supabase before billing actions will work."
    );
  }
  _stripe = new Stripe(key);
  return _stripe;
}

export const PLAN_PRICE_ENV: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  enterprise: "STRIPE_PRICE_ENTERPRISE",
};

export function priceIdForPlan(plan: string): string {
  const envVar = PLAN_PRICE_ENV[plan];
  const priceId = envVar ? process.env[envVar] : undefined;
  if (!priceId) {
    throw new Error(
      `No Stripe price ID configured for plan "${plan}". Create the price in your Stripe dashboard and set ${envVar ?? "the matching env var"}.`
    );
  }
  return priceId;
}
