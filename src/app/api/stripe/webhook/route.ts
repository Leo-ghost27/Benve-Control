import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Real Stripe webhook handler. Requires STRIPE_WEBHOOK_SECRET to be set
 * to the signing secret shown when you add this endpoint
 * (https://your-domain/api/stripe/webhook) in the Stripe Dashboard ->
 * Developers -> Webhooks. Uses the service-role Supabase client since
 * this route has no user session — Stripe is the only caller, verified
 * via signature, not by Supabase Auth.
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not configured." },
      { status: 500 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Signature verification failed: ${(err as Error).message}` }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.client_reference_id;
      if (organizationId && session.customer && session.subscription) {
        await admin.from("organization_billing").upsert({
          organization_id: organizationId,
          stripe_customer_id: String(session.customer),
          stripe_subscription_id: String(session.subscription),
          billing_status: "active",
          updated_at: new Date().toISOString(),
        });
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.organization_id;
      if (organizationId) {
        const currentPeriodEnd = (subscription as unknown as { current_period_end?: number })
          .current_period_end;
        await admin.from("organization_billing").upsert({
          organization_id: organizationId,
          stripe_customer_id: String(subscription.customer),
          stripe_subscription_id: subscription.id,
          billing_status: mapStripeStatus(subscription.status),
          current_period_end: currentPeriodEnd
            ? new Date(currentPeriodEnd * 1000).toISOString().slice(0, 10)
            : null,
          updated_at: new Date().toISOString(),
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.organization_id;
      if (organizationId) {
        await admin
          .from("organization_billing")
          .update({ billing_status: "canceled", updated_at: new Date().toISOString() })
          .eq("organization_id", organizationId);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        typeof (invoice as unknown as { subscription?: string }).subscription === "string"
          ? (invoice as unknown as { subscription?: string }).subscription
          : null;
      if (subscriptionId) {
        await admin
          .from("organization_billing")
          .update({ billing_status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }

    default:
      // Unhandled event types are fine to ignore.
      break;
  }

  return NextResponse.json({ received: true });
}

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}
