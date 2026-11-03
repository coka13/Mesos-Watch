// PayPal / crypto payments on the full migration stack: sponsor slots and donations are written only by the service role,
// buyers read their own, visitors see only live banners and opted-in paid donations, and approval needs a verified payment.
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
await db.exec(`grant all on all tables in schema public to service_role;`);
const A='00000000-0000-0000-0000-00000000000a',B='00000000-0000-0000-0000-00000000000b',C='00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users values('${A}','a@example.test'),('${B}','b@example.test'),('${C}','c@example.test');insert into admins values('${C}')`);
const as=async(role,uid,sql,args=[])=>{await db.exec(`set role ${role};select set_config('request.jwt.claim.sub','${uid}',false);select set_config('request.jwt.claims','${role==='service_role'?'{"role":"service_role"}':''}',false)`);try{return(await db.query(sql,args)).rows;}finally{await db.exec('reset role');}};
const svc=(sql,args)=>as('service_role','',sql,args);

// Sponsor slots
const [plan]=await as('anon','',`select id,days,price_cents from sponsor_plans order by sort limit 1`);
assert.ok(plan&&plan.price_cents>0,'sponsor plans readable');
await assert.rejects(as('authenticated',A,`insert into sponsors(buyer,title,url,plan_id,days,price_cents,provider) values($1,'Mine','https://example.com',$2,7,1500,'paypal')`,[A,plan.id]),/permission denied|row-level/,'players cannot write slots');
await assert.rejects(svc(`insert into sponsors(buyer,title,url,plan_id,days,price_cents,provider) values($1,'Bad','http://example.com',$2,7,1500,'paypal')`,[A,plan.id]),/check/,'https links only');
const [s]=await svc(`insert into sponsors(buyer,title,url,plan_id,days,price_cents,provider,checkout_session) values($1,'Steely Shop','https://example.com/shop',$2,$3,$4,'paypal','paypal:ORDER1') returning id`,[A,plan.id,plan.days,plan.price_cents]);
assert.equal((await as('authenticated',B,`select id from sponsors`)).length,0,'others cannot see a buyer slot');
assert.equal((await as('authenticated',A,`select id from sponsors`)).length,1,'buyer sees own slot');
await assert.rejects(as('authenticated',C,`select approve_sponsor($1)`,[s.id]),/awaiting_payment/,'unpaid slot cannot be approved');
await svc(`update sponsors set status='paid_pending_review',paid_at=now(),payment_intent='paypal:CAP1' where id=$1`,[s.id]);
await assert.rejects(as('authenticated',A,`select approve_sponsor($1)`,[s.id]),/admins only/);
const [ok]=await as('authenticated',C,`select status from approve_sponsor($1)`,[s.id]);
assert.equal(ok.status,'scheduled');
const live=await as('anon','',`select * from live_sponsors`);
assert.deepEqual(live.map(l=>l.title),['Steely Shop']);
assert.ok(!('buyer' in live[0])&&!('payment_intent' in live[0]),'no buyer or payment data public');
await assert.rejects(as('authenticated',A,`select moderate_sponsor($1,'remove','')`,[s.id]),/admins only/);
await as('authenticated',C,`select moderate_sponsor($1,'remove','test over')`,[s.id]);
assert.equal((await as('anon','',`select * from live_sponsors`)).length,0,'removed slot hidden');
// Paid slots beyond the slot count queue up instead of overlapping.
const ids=[];for(let i=0;i<4;i++)ids.push((await svc(`insert into sponsors(buyer,title,url,plan_id,days,price_cents,provider,checkout_session,status,paid_at,payment_intent) values($1,$2,'https://example.com',$3,$4,$5,'crypto',$6,'paid_pending_review',now(),'crypto:1') returning id`,[A,'Slot '+i,plan.id,plan.days,plan.price_cents,'crypto:INV'+i]))[0].id);
for(const id of ids)await as('authenticated',C,`select approve_sponsor($1,3)`,[id]);
assert.equal((await as('anon','',`select * from live_sponsors`)).length,3,'three slots at once');
assert.equal((await svc(`select count(*)::int n from sponsors where status='scheduled' and starts_at>now()`))[0].n,1,'fourth slot queued');

// Donations
await assert.rejects(svc(`insert into donations(donor,amount_cents,provider) values($1,50,'paypal')`,[A]),/check/,'minimum $1');
await svc(`insert into donations(donor,amount_cents,name,message,public,provider,status,paid_at,livemode) values($1,500,'Kind Mapler','Keep it up!',true,'paypal','paid',now(),true),($1,300,'Secret','',false,'crypto','paid',now(),true),($1,900,'Pending','',true,'paypal','awaiting_payment',null,true),($1,700,'Sandbox','',true,'paypal','paid',now(),false)`,[A]);
const wall=await as('anon','',`select * from donor_wall`);
assert.deepEqual(wall.map(d=>d.name),['Kind Mapler'],'only real, paid, public donations on the wall');
assert.ok(!('amount_cents' in wall[0]),'amounts stay private');
assert.equal((await as('authenticated',B,`select id from donations`)).length,0,'donations private to the donor');
assert.equal((await as('authenticated',C,`select id from donations`)).length,4,'admins see all donations');

// Megaphones accept the new providers only.
assert.equal((await db.query(`select count(*)::int n from pg_constraint where conname='megaphones_provider_check'`)).rows[0].n,1,'known providers only');
console.log('PayPal/crypto payments SQL: sponsor slots, queueing, donations, privacy, approval: ok');
await db.close();
