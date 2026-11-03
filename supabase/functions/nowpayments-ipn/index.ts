// NOWPayments IPN: the only place a crypto payment becomes paid. Deploy with --no-verify-jwt; every request must carry a
// valid HMAC-SHA512 signature made with NOWPAYMENTS_IPN_SECRET, and must match the row's invoice, currency and price.
import { cryptoPaid, parseOrderRef, verifyNowPayments } from '../_shared/pay-rules.js';
import { loadRow, markCancelled, markPaid } from '../_shared/campaigns.js';
import { env, json, service } from '../_shared/util.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const text = await req.text();
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Bad body' }, 400); }
  if (!await verifyNowPayments(body, req.headers.get('x-nowpayments-sig'), env('NOWPAYMENTS_IPN_SECRET'))) return json({ error: 'Bad signature' }, 400);
  try {
    const ref = parseOrderRef(body.order_id);
    const db = service();
    const row = ref && await loadRow(db, ref.kind, ref.id);
    if (!row || row.provider !== 'crypto') return json({ received: true, ignored: 'unknown order' });
    if (body.invoice_id != null && row.checkout_session !== 'crypto:' + body.invoice_id) return json({ received: true, ignored: 'other invoice' });
    if (row.status !== 'awaiting_payment') return json({ received: true });
    if (['expired', 'failed'].includes(body.payment_status)) { await markCancelled(db, row); return json({ received: true }); }
    const check = cryptoPaid(body, row);
    if (!check.ok) { if (!check.pending) console.error('crypto mismatch', row.id, check.reason, body.payment_status); return json({ received: true }); }
    await markPaid(db, row, check.payment, row.livemode);
    return json({ received: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'handler failed' }, 500);  // NOWPayments retries
  }
});
