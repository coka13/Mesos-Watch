// Stripe webhook: the only place a megaphone becomes paid. Deploy with --no-verify-jwt; requests are verified by Stripe's signature.
import Stripe from 'npm:stripe@14.25.0';
import { env, json, service, stripe } from '../_shared/util.js';

import {handlePaymentEvent,paymentAdapter} from '../_shared/payment-events.js';
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') ?? '', env('STRIPE_WEBHOOK_SECRET'), undefined, crypto);
  } catch (e) {
    return json({ error: 'Bad signature' }, 400);
  }
  const db = service();
  try {
    const output=await handlePaymentEvent(event,paymentAdapter(db,Number(env('MEGAPHONE_SLOTS','8'))),{autoApprove:env('MEGAPHONE_AUTO_APPROVE','false')==='true'});
    return json(output);
  } catch (e) {
    console.error(e);
    return json({ error: 'handler failed' }, 500);  // Stripe retries
  }
});
