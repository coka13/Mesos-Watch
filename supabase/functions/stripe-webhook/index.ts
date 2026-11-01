// Stripe webhook: the only place a megaphone becomes paid. Deploy with --no-verify-jwt; requests are verified by Stripe's signature.
import Stripe from 'npm:stripe@14.25.0';
import { env, json, service, stripe } from '../_shared/util.js';

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
    const session = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (session.payment_status !== 'paid') return json({ received: true, pending: true });
      const id = session.metadata?.megaphone_id;
      const { data: mega } = await db.from('megaphones').select('*').eq('id', id).eq('checkout_session', session.id).maybeSingle();
      if (!mega) return json({ received: true, ignored: 'unknown megaphone' });
      if (mega.status !== 'awaiting_payment') return json({ received: true, duplicate: true });  // Stripe retries: handled once
      if (session.amount_total !== mega.price_cents || session.currency !== mega.currency) {
        console.error('amount mismatch', id, session.amount_total, mega.price_cents);
        return json({ received: true, ignored: 'amount mismatch' });
      }
      await db.from('megaphones').update({ status: 'paid_pending_review', paid_at: new Date().toISOString(), payment_intent: session.payment_intent, livemode: session.livemode })
        .eq('id', id).eq('status', 'awaiting_payment');
      if (env('MEGAPHONE_AUTO_APPROVE', 'false') === 'true') {
        const { error } = await db.rpc('approve_megaphone', { p_id: id, p_slots: Number(env('MEGAPHONE_SLOTS', '8')) });
        if (error) console.error('auto-approve failed', id, error.message);
      }
    } else if (event.type === 'checkout.session.expired') {
      await db.from('megaphones').update({ status: 'cancelled' }).eq('checkout_session', session.id).eq('status', 'awaiting_payment');
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      if (charge.refunded) await db.from('megaphones').update({ status: 'refunded', starts_at: null, ends_at: null }).eq('payment_intent', charge.payment_intent).neq('status', 'refunded');
    }
    return json({ received: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'handler failed' }, 500);  // Stripe retries
  }
});
