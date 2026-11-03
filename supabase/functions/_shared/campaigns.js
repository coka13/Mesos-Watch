// Loading and confirming the paid rows (megaphones, sponsor slots, donations) for the PayPal and crypto functions.
import { env } from './util.js';
import { KINDS, orderRef } from './pay-rules.js';

export async function loadRow(db, kind, id) {
  const table = KINDS[kind];
  if (!table) return null;
  const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Payment database read failed');
  return data && { ...data, kind, table, ref: orderRef(kind, id), price_cents: kind === 'donation' ? data.amount_cents : data.price_cents };
}

// Idempotent: only an awaiting row changes, so provider retries and page reloads are harmless.
export async function markPaid(db, row, payment, livemode) {
  const status = row.kind === 'donation' ? 'paid' : 'paid_pending_review';
  const { error } = await db.from(row.table).update({ status, paid_at: new Date().toISOString(), payment_intent: payment, livemode })
    .eq('id', row.id).eq('status', 'awaiting_payment');
  if (error) throw new Error('Payment database write failed');
  const auto = row.kind === 'megaphone' ? env('MEGAPHONE_AUTO_APPROVE', 'false') : row.kind === 'sponsor' ? env('SPONSOR_AUTO_APPROVE', 'false') : 'false';
  if (auto === 'true') {
    const fn = row.kind === 'megaphone' ? 'approve_megaphone' : 'approve_sponsor';
    const { error: e } = await db.rpc(fn, row.kind === 'megaphone' ? { p_id: row.id, p_slots: Number(env('MEGAPHONE_SLOTS', '8')) } : { p_id: row.id });
    if (e) console.error('auto-approve failed', row.kind, row.id, e.message);  // stays in the review queue
  }
  return status;
}

export async function markCancelled(db, row) {
  await db.from(row.table).update({ status: 'cancelled' }).eq('id', row.id).eq('status', 'awaiting_payment');
}
