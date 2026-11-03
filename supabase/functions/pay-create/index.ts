// Starts a PayPal or crypto (NOWPayments) payment for a megaphone, a sponsor slot or a donation. The row is created here
// with the price from the database; it becomes paid only in paypal-capture or nowpayments-ipn after the provider confirms.
import { checkMegaphone } from '../_shared/megaphone-rules.js';
import { checkDonation, checkSponsor, KINDS, orderRef, PROVIDERS } from '../_shared/pay-rules.js';
import { cryptoCreateInvoice, cryptoLivemode, paypalCreateOrder, paypalLivemode } from '../_shared/providers.js';
import { caller, cors, json, origins, service } from '../_shared/util.js';

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  try {
    const user = await caller(req);
    if (!user) return json({ error: 'Session expired. Reload the page and try again.' }, 401, headers);
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind), provider = String(body.provider);
    if (!KINDS[kind] || !PROVIDERS.includes(provider)) return json({ error: 'Choose PayPal or crypto.' }, 400, headers);
    const returnTo = String(body.return_url ?? '');
    const origin = origins().find(o => returnTo === o || returnTo.startsWith(o + '/'));
    if (!origin) return json({ error: 'This site is not allowed to start a payment.' }, 400, headers);
    const db = service(), table = KINDS[kind];

    const { count } = await db.from(table).select('id', { count: 'exact', head: true })
      .eq(kind === 'donation' ? 'donor' : 'buyer', user.id).eq('status', 'awaiting_payment').gt('created_at', new Date(Date.now() - 3600e3).toISOString());
    if ((count ?? 0) >= 5) return json({ error: 'Too many unfinished payments. Finish one or wait an hour.' }, 429, headers);

    let row, cents, description;
    if (kind === 'megaphone') {
      const { message, sender, errors } = checkMegaphone(body);
      if (errors.length) return json({ error: errors.join(' ') }, 400, headers);
      const { data: plan } = await db.from('megaphone_plans').select('*').eq('id', body.plan_id).eq('active', true).maybeSingle();
      if (!plan) return json({ error: 'Choose a megaphone duration.' }, 400, headers);
      if (plan.currency !== 'usd') return json({ error: 'This plan cannot be paid with PayPal or crypto.' }, 400, headers);
      // Optional item reference, checked the same way as in megaphone-checkout.
      let item_id: number | null = null;
      if (body.item_id != null && body.item_id !== '') {
        const iid = Number(body.item_id);
        if (!Number.isSafeInteger(iid) || iid <= 0) return json({ error: 'Choose the item again.' }, 400, headers);
        const { data: item } = await db.from('visible_items').select('id').eq('id', iid).maybeSingle();
        if (!item) return json({ error: 'That item is not in the catalog.' }, 400, headers);
        item_id = iid;
      }
      row = { buyer: user.id, message, sender, world: String(body.world ?? '').slice(0, 32), plan_id: plan.id, minutes: plan.minutes, price_cents: plan.price_cents, currency: 'usd', ...(item_id ? { item_id } : {}) };
      cents = plan.price_cents; description = `FM Megaphone · ${plan.label}`;
    } else if (kind === 'sponsor') {
      const { title, url, image_url, errors } = checkSponsor(body);
      if (errors.length) return json({ error: errors.join(' ') }, 400, headers);
      const { data: plan } = await db.from('sponsor_plans').select('*').eq('id', body.plan_id).eq('active', true).maybeSingle();
      if (!plan) return json({ error: 'Choose a sponsor duration.' }, 400, headers);
      row = { buyer: user.id, title, url, image_url, plan_id: plan.id, days: plan.days, price_cents: plan.price_cents, currency: 'usd' };
      cents = plan.price_cents; description = `Mesos-Watch sponsor · ${plan.label}`;
    } else {
      const d = checkDonation(body);
      if (d.errors.length) return json({ error: d.errors.join(' ') }, 400, headers);
      row = { donor: user.id, amount_cents: d.amount_cents, name: d.name, message: d.message, public: d.public, currency: 'usd' };
      cents = d.amount_cents; description = 'Donation to Mesos-Watch';
    }

    const { data: created, error } = await db.from(table).insert({ ...row, provider, livemode: provider === 'paypal' ? paypalLivemode() : cryptoLivemode() }).select('id').single();
    if (error) throw error;
    const ref = orderRef(kind, created.id);
    const back = `${origin}/#pay?kind=${kind}&id=${created.id}&provider=${provider}`;
    const out = provider === 'paypal'
      ? await paypalCreateOrder({ ref, cents, description, returnUrl: back + '&result=return', cancelUrl: back + '&result=cancel', requestId: 'create-' + created.id })
      : await cryptoCreateInvoice({ ref, cents, description, successUrl: back + '&result=return', cancelUrl: back + '&result=cancel' });
    await db.from(table).update({ checkout_session: `${provider}:${out.id}` }).eq('id', created.id);
    return json({ url: out.url, id: created.id }, 200, headers);
  } catch (e) {
    console.error(e);
    return json({ error: 'Payment is unavailable right now. ' + (e instanceof Error ? e.message : '') }, 500, headers);
  }
});
