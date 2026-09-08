import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdForPlan } from "@/lib/stripe/client";

/**
 * Creates a real Stripe Checkout Session for the current user's
 * organization and redirects to Stripe's hosted checkout page.
 * Requires STRIPE_SECRET_KEY and a price ID for the requested plan
 * to be configured — see src/lib/stripe/client.ts.
 */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    return NextResponse.json({ error: "Not signed in to an organization." }, { status: 401 });
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return NextResponse.json({ error: "Only an owner or admin can manage billing." }, { status: 403 });
  }

  const { plan } = await request.json();
  if (typeof plan !== "string") {
    return NextResponse.json({ error: "Missing plan." }, { status: 400 });
  }

  let priceId: string;
  try {
    priceId = priceIdForPlan(plan);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: billing } = await supabase
    .from("organization_billing")
    .select("stripe_customer_id")
    .eq("organization_id", ctx.org.id)
    .maybeSingle();

  const origin = request.nextUrl.origin;

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: billing?.stripe_customer_id ?? undefined,
      client_reference_id: ctx.org.id,
      subscription_data: { metadata: { organization_id: ctx.org.id } },
      success_url: `${origin}/dashboard/settings?billing=success`,
      cancel_url: `${origin}/dashboard/settings?billing=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
