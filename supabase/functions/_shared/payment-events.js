// Signature verification belongs to the caller. This handler never trusts browser payment state.
export async function handlePaymentEvent(event,adapter,{autoApprove=false}={}){
 const value=event.data.object;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
  if(value.payment_status!=='paid')return{received:true,pending:true};
  let mega=await adapter.find(value.metadata?.megaphone_id,value.id);
  if(!mega)return{received:true,ignored:'unknown campaign'};
  if(value.amount_total!==mega.price_cents||value.currency!==mega.currency||!value.payment_intent)throw Error('Payment amount, currency or intent mismatch');
  if(mega.status==='awaiting_payment')mega=await adapter.markPaid(mega.id,value);
  if(autoApprove&&mega.status==='paid_pending_review')await adapter.approve(mega.id);
  return{received:true};
 }
 if(event.type==='checkout.session.expired')await adapter.expire(value.id);
 if(event.type==='charge.refunded'&&value.refunded)await adapter.refund(value.payment_intent);
 return{received:true};
}
export function paymentAdapter(db,slots=8){
 const check=({data,error})=>{if(error)throw Error('Payment database write/read failed');return data;};
 const find=async(id,session)=>check(await db.from('megaphones').select('*').eq('id',id).eq('checkout_session',session).maybeSingle());
 return{
  find,
  async markPaid(id,s){check(await db.from('megaphones').update({status:'paid_pending_review',paid_at:new Date().toISOString(),payment_intent:s.payment_intent,livemode:s.livemode}).eq('id',id).eq('status','awaiting_payment'));const row=await find(id,s.id);if(!row)throw Error('Payment campaign disappeared');return row;},
  async approve(id){const {error}=await db.rpc('approve_megaphone',{p_id:id,p_slots:slots});if(error){const current=check(await db.from('megaphones').select('status').eq('id',id).single());if(current.status!=='scheduled')throw Error('Paid campaign approval failed; retry required');}},
  async expire(id){check(await db.from('megaphones').update({status:'cancelled'}).eq('checkout_session',id).eq('status','awaiting_payment'));},
  async refund(intent){check(await db.from('megaphones').update({status:'refunded',starts_at:null,ends_at:null}).eq('payment_intent',intent).neq('status','refunded'));}
 };
}
