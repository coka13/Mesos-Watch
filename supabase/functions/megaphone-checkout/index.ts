// Creates a pending megaphone and a Stripe Checkout session for it. The megaphone goes live only after the webhook
// confirms payment (and, unless MEGAPHONE_AUTO_APPROVE=true, after an admin approves it).
import { checkMegaphone } from '../_shared/megaphone-rules.js';
import { caller, cors, json, origins, service, stripe } from '../_shared/util.js';

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  try {
    const user = await caller(req);
    if (!user?.email) return json({ error: 'Sign in by email before purchasing a campaign.' }, 401, headers);
    const body = await req.json().catch(() => ({}));
    const { message, sender, errors } = checkMegaphone(body);
    if (errors.length) return json({ error: errors.join(' ') }, 400, headers);
    const world = String(body.world ?? '').slice(0, 32);
    const returnTo = String(body.return_url ?? '');
    const origin = origins().find(o => returnTo === o || returnTo.startsWith(o + '/'));
    if (!origin) return json({ error: 'This site is not allowed to start a checkout.' }, 400, headers);

    const db = service();
    const { data: plan } = await db.from('megaphone_plans').select('*').eq('id', body.plan_id).eq('active', true).maybeSingle();
    if (!plan) return json({ error: 'Choose a megaphone duration.' }, 400, headers);
    const { count } = await db.from('megaphones').select('id', { count: 'exact', head: true })
      .eq('buyer', user.id).eq('status', 'awaiting_payment').gt('created_at', new Date(Date.now() - 3600e3).toISOString());
    if ((count ?? 0) >= 5) return json({ error: 'Too many unfinished checkouts. Finish or wait an hour.' }, 429, headers);

    // Optional item reference: must be a whole positive id of an item visible in the public catalog.
    let item_id: number | null = null;
    if (body.item_id != null && body.item_id !== '') {
      const id = Number(body.item_id);
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'Choose the item again.' }, 400, headers);
      const { data: item } = await db.from('visible_items').select('id').eq('id', id).maybeSingle();
      if (!item) return json({ error: 'That item is not in the catalog.' }, 400, headers);
      item_id = id;
    }

    const { data: mega, error } = await db.from('megaphones').insert({
      buyer: user.id, message, sender, world, plan_id: plan.id, minutes: plan.minutes, price_cents: plan.price_cents, currency: plan.currency,
      ...(item_id ? { item_id } : {}),
    }).select('id').single();
    if (error) throw error;

    const s = stripe();
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: plan.currency, unit_amount: plan.price_cents, product_data: { name: `FM Megaphone · ${plan.label}`, description: message } } }],
      client_reference_id: mega.id,
      metadata: { megaphone_id: mega.id },
      payment_intent_data: { metadata: { megaphone_id: mega.id } },
      success_url: `${origin}/#megaphones?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#megaphones?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const {error:linkError}=await db.from('megaphones').update({ checkout_session: session.id, livemode: session.livemode }).eq('id', mega.id);
    if(linkError){await s.checkout.sessions.expire(session.id);throw Error('Could not save checkout. Try again later.');}
    return json({ url: session.url, id: mega.id, test_mode: !session.livemode }, 200, headers);
  } catch (e) {
    console.error(e);
    return json({ error: 'Checkout is unavailable right now. ' + (e instanceof Error ? e.message : '') }, 500, headers);
  }
});
