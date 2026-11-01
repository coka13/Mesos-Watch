import fs from 'node:fs';
let webhook=fs.readFileSync('supabase/functions/stripe-webhook/index.ts','utf8');
webhook=webhook.replace("const crypto =", "import {handlePaymentEvent,paymentAdapter} from '../_shared/payment-events.js';\nconst crypto =");
webhook=webhook.replace(/    const session = event.data.object;[\s\S]*?    return json\(\{ received: true \}\);/,"    const output=await handlePaymentEvent(event,paymentAdapter(db,Number(env('MEGAPHONE_SLOTS','8'))),{autoApprove:env('MEGAPHONE_AUTO_APPROVE','false')==='true'});\n    return json(output);");
fs.writeFileSync('supabase/functions/stripe-webhook/index.ts',webhook);
let checkout=fs.readFileSync('supabase/functions/megaphone-checkout/index.ts','utf8');checkout=checkout.replace("if (!user)","if (!user?.email)");checkout=checkout.replace('Session expired. Reload the page and try again.','Sign in by email before purchasing a campaign.');
checkout=checkout.replace("    await db.from('megaphones').update({ checkout_session: session.id, livemode: session.livemode }).eq('id', mega.id);","    const {error:linkError}=await db.from('megaphones').update({ checkout_session: session.id, livemode: session.livemode }).eq('id', mega.id);\n    if(linkError){await s.checkout.sessions.expire(session.id);throw Error('Could not save checkout. Try again later.');}");
fs.writeFileSync('supabase/functions/megaphone-checkout/index.ts',checkout);
const original=fs.readFileSync('supabase/migrations/20261101000100_megaphones.sql','utf8');
let approval=original.slice(original.indexOf('create or replace function public.approve_megaphone'),original.indexOf('-- Live rotation'));
approval=approval.replace("  v_start :=", "  if m.paid_at is null or m.checkout_session is null or m.payment_intent is null or m.price_cents<=0 or m.test then raise exception 'Verified payment required'; end if;\n  if p_slots<1 or p_slots>100 then raise exception 'Slots must be between 1 and 100';end if;\n  v_start :=");
fs.writeFileSync('supabase/migrations/20261101001200_payment_safety.sql',`-- Retire old packages without deleting referenced plans or campaigns.
update megaphone_plans set active=false;
insert into megaphone_plans(id,label,minutes,price_cents,sort,active)values('basic30','Basic · 30 minutes',30,199,1,true),('premium120','Premium · 2 hours',120,399,2,true),('featured360','Featured · 6 hours',360,599,3,true)
 on conflict(id)do update set label=excluded.label,minutes=excluded.minutes,price_cents=excluded.price_cents,sort=excluded.sort,active=true;
-- Free code-based test ads are retired. Use Stripe sandbox checkout instead.
create or replace function public.post_test_megaphone(p_code text,p_message text,p_sender text default '',p_world text default '',p_plan text default null) returns public.megaphones language plpgsql security definer set search_path=public as $$begin raise exception 'Disabled: use verified Stripe sandbox checkout';end $$;
create or replace view public.live_megaphones as select id,message,sender,world,starts_at,ends_at from megaphones where status='scheduled' and starts_at<=now()and ends_at>now()and not test;
`+approval);
let site=fs.readFileSync('dist/site.mjs','utf8');site=site.replace(/const FALLBACK_PLANS=\[[^\n]+;/,"const FALLBACK_PLANS=[{id:'basic30',label:'Basic · 30 minutes',price_cents:199,minutes:30},{id:'premium120',label:'Premium · 2 hours',price_cents:399,minutes:120},{id:'featured360',label:'Featured · 6 hours',price_cents:599,minutes:360}];");
site=site.replace("until '+new Date(m.ends_at)","'Campaign '+m.id+' · until '+new Date(m.ends_at)");
site=site.replace("label[m.display_status]||m.display_status,", "'Campaign '+m.id,label[m.display_status]||m.display_status,");fs.writeFileSync('dist/site.mjs',site);
let html=fs.readFileSync('dist/index.html','utf8');html=html.replace('<div id="mg-plans"', '<p class="hint">Sign in under Player Stores before checkout. Packages buy campaign time in a fair rotation, not continuous display or a guaranteed number of views. Stripe sandbox mode stays on until production is configured.</p><div id="mg-plans"');
html=html.replace(/\$1 for 1 h[^<]+/g,'Basic $1.99 / 30 minutes · Premium $3.99 / 2 hours · Featured $5.99 / 6 hours.');fs.writeFileSync('dist/index.html',html);
