// Admin moderation: approve, reject (refunds if paid) or remove a live/queued megaphone (optional refund).
import { caller, cors, env, json, service, stripe } from '../_shared/util.js';

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  try {
    const user = await caller(req);
    const db = service();
    const { data: admin } = user ? await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle() : { data: null };
    if (!admin) return json({ error: 'Admins only.' }, 403, headers);
    const { action, id, reason = '', refund = true } = await req.json().catch(() => ({}));
    const { data: mega } = await db.from('megaphones').select('*').eq('id', id).maybeSingle();
    if (!mega) return json({ error: 'Megaphone not found.' }, 404, headers);
    const note = String(reason).slice(0, 200);
    const reviewed = { reviewed_at: new Date().toISOString(), reviewed_by: user.id, reject_reason: note || null };

    if (action === 'approve') {
      const { data, error } = await db.rpc('approve_megaphone', { p_id: id, p_slots: Number(env('MEGAPHONE_SLOTS', '8')) });
      if (error) return json({ error: error.message }, 400, headers);
      return json({ megaphone: data }, 200, headers);
    }
    if (action === 'reject' || action === 'remove') {
      if (action === 'reject' && mega.status !== 'paid_pending_review' && mega.status !== 'awaiting_payment') return json({ error: `Cannot reject a ${mega.status} megaphone.` }, 400, headers);
      if (action === 'remove' && mega.status !== 'scheduled') return json({ error: 'Only scheduled megaphones can be removed.' }, 400, headers);
      let status = action === 'reject' ? 'rejected' : 'removed';
      if (mega.payment_intent && (action === 'reject' || refund)) {
        await stripe().refunds.create({ payment_intent: mega.payment_intent, metadata: { megaphone_id: id, reason: note } }, { idempotencyKey: `megaphone-refund-${id}` });
        status = 'refunded';
      }
      const { data, error } = await db.from('megaphones').update({ status, starts_at: null, ends_at: null, ...reviewed }).eq('id', id).eq('status', mega.status).select().single();
      if (error) return json({ error: error.message }, 400, headers);
      return json({ megaphone: data }, 200, headers);
    }
    return json({ error: 'Unknown action.' }, 400, headers);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Failed' }, 500, headers);
  }
});
