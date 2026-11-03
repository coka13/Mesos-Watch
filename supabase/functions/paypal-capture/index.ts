// Completes a PayPal payment after the buyer approves it and returns to the site. The capture happens here, on the
// server, and the row is marked paid only if PayPal reports a completed capture for this row's exact amount.
import { paypalPaid } from '../_shared/pay-rules.js';
import { loadRow, markCancelled, markPaid } from '../_shared/campaigns.js';
import { paypalCapture } from '../_shared/providers.js';
import { caller, cors, json, service } from '../_shared/util.js';

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  try {
    const { kind, id, cancel } = await req.json().catch(() => ({}));
    const db = service();
    const row = /^[0-9a-f-]{36}$/.test(String(id)) ? await loadRow(db, String(kind), String(id)) : null;
    if (!row || row.provider !== 'paypal' || !String(row.checkout_session).startsWith('paypal:')) return json({ error: 'Payment not found.' }, 404, headers);
    if (row.status !== 'awaiting_payment') return json({ status: row.status }, 200, headers);
    if (cancel === true) {
      const user = await caller(req);
      if (!user || user.id !== (row.buyer ?? row.donor)) return json({ error: 'Only the buyer can cancel this payment.' }, 403, headers);
      await markCancelled(db, row); return json({ status: 'cancelled' }, 200, headers);
    }

    const order = await paypalCapture(row.checkout_session.slice(7), 'capture-' + row.id);
    if (order.status === 'NOT_APPROVED') return json({ status: 'awaiting_payment', note: 'The payment was not approved in PayPal.' }, 200, headers);
    const check = paypalPaid(order, row);
    if (!check.ok) {
      if (check.pending) return json({ status: 'pending', note: 'PayPal is still processing this payment.' }, 200, headers);
      console.error('paypal mismatch', row.id, check.reason);
      return json({ error: 'PayPal did not confirm this payment.' }, 400, headers);
    }
    return json({ status: await markPaid(db, row, 'paypal:' + check.payment, row.livemode) }, 200, headers);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Failed' }, 500, headers);
  }
});
