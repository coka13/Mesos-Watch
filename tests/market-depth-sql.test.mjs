// Market windows, the listing lifecycle, flips and rankings (migration 20261107000000) on the full migration stack in PGlite.
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const A='00000000-0000-0000-0000-00000000000a',B='00000000-0000-0000-0000-00000000000b',ADMIN='00000000-0000-0000-0000-0000000000ad';
await db.exec(`insert into auth.users values('${A}','a@example.test'),('${B}','b@example.test'),('${ADMIN}','admin@example.test');insert into admins values('${ADMIN}')`);
const as=async(uid,sql,args=[])=>{await db.exec(`set role ${uid?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${uid}',false)`);try{return(await db.query(sql,args)).rows;}finally{await db.exec('reset role');}};
const newItem=async(name,category='use')=>(await db.query(`insert into items(name,game_id,verified,source,release_status,category)values($1,$2,true,'catalog','released',$3)returning id`,[name,1000000+Math.floor(Math.random()*8e6),category])).rows[0].id;
const potion=await newItem('Orange Potion'),gloves=await newItem('Work Gloves','equip'),scroll=await newItem('Scroll of Testing');
const key=t=>t?('|free market 14|'+t).toLowerCase():'';
const ask=(uid,{item='Orange Potion',price=100,title='Shop A',channel=4,room=14,qty=1}={})=>as(uid,`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)
 values('ask','',$1,$2,$3,$4,$5,$6,$7,'scanner','FM_ROOM',$8,'AUTO',75)returning id`,[item,price,qty,key(title),title,'Free Market '+room,channel,room]);
const sold=(uid,{item='Orange Potion',price=100,title='Shop A',channel=4,room=14}={})=>as(uid,`insert into sold_sightings(world,channel,location_type,room,location_source,shop_key,shop_title,item_name,listed_price,qty)
 values('',$1,'FM_ROOM',$2,'AUTO',$3,$4,$5,$6,1)returning id`,[channel,room,key(title),title,item,price]);
const age=(id,hours)=>db.query(`update observations set seen_at=now()-make_interval(hours=>$2),last_seen_at=now()-make_interval(hours=>$2) where id=$1`,[id,hours]);
const stats=async(item,days=7)=>(await as('',`select item_stats($1,'',$2) s`,[item,days]))[0].s;
const index=async(days=7)=>await as('',`select * from market_index_window('',300,$1)`,[days]);
const shops=['Shop A','Shop B','Shop C','Shop D','Shop E','Shop F'];

// Existing functions keep working; the new windowed ones agree with them.
for(const [i,p] of [100,110,120,130].entries())await ask(A,{price:p,title:shops[i],channel:i+1});
{const [row]=await as('',`select * from market_index('',10)`);assert.equal(Number(row.ask_median),110);
 const [win]=await index();assert.equal(Number(win.ask_median),110,'same median as market_index');assert.equal(Number(win.listings),4);assert.equal(win.window_days,7);assert.equal(Number(win.for_sale_now),4);}

// Windows: an old listing counts only in a window long enough to reach it.
{const [o]=await ask(A,{item:'Scroll of Testing',price:5000,title:'Old Shop'});await age(o.id,24*20);const [n]=await ask(A,{item:'Scroll of Testing',price:7000,title:'New Shop'});
 assert.equal((await stats(scroll,7)).listings,1);assert.equal((await stats(scroll,14)).listings,1);assert.equal((await stats(scroll,30)).listings,2,'20 days old is in the 30 day window');
 assert.equal((await stats(scroll,7)).median,7000);assert.equal((await stats(scroll,30)).window_days,30);assert.equal((await stats(scroll,999)).window_days,7,'unknown windows fall back');
 assert.equal(Number((await index(7)).find(r=>r.name==='Scroll of Testing').listings),1);assert.equal(Number((await index(30)).find(r=>r.name==='Scroll of Testing').listings),2);}

// Stale listings are counted apart and are no longer for sale.
{const [o]=await ask(A,{item:'Work Gloves',price:900,title:'Stale Shop'});await age(o.id,30);const s=await stats(gloves);assert.equal(s.stale_listings,1);assert.equal(s.for_sale_now,0);assert.equal(s.lowest_now,null);assert.equal(s.listings,1);}

// Repeat sightings are folded, not counted as listings.
{await ask(B,{price:100,title:'Shop A',channel:1});const s=await stats(potion);assert.equal(s.listings,4,'still 4 listings');assert.equal(s.repeats_folded,1,'one repeat sighting');}

// Outliers: a misread stays in the record but does not set the lowest price or the median.
{await ask(A,{price:2,title:'Shop E',channel:9});await ask(A,{price:100000,title:'Shop F',channel:9});const s=await stats(potion);
 assert.equal(s.unusual,2);assert.equal(s.lowest_now,100,'a misread 2 does not set the lowest');assert.ok(s.median>=100&&s.median<=130,'median barely moves: '+s.median);assert.ok(s.highest<=130*5,'highest ignores it');
 const [row]=(await index()).filter(r=>r.name==='Orange Potion');assert.equal(Number(row.lowest_now),100);assert.equal(Number(row.unusual),2);}

// Fewer than 3 listings: nothing is called unusual.
{const item=await newItem('Lone Item');await ask(A,{item:'Lone Item',price:5});await ask(A,{item:'Lone Item',price:5000,title:'Shop B'});const s=await stats(item);assert.equal(s.unusual,0);assert.equal(s.lowest_now,5);}

// Lifecycle: a shop seen whole closes what it no longer has. The listing is gone, not sold, and it comes back if seen again.
{const item=await newItem('Blue Potion');const place={item:'Blue Potion',title:'Whole Shop',channel:7,room:3};
 const [a]=await ask(A,{...place,price:50}),[b]=await ask(A,{...place,price:60});
 await db.query(`update observations set last_seen_at=now()-interval '10 minutes',seen_at=now()-interval '10 minutes' where id=any($1)`,[[a.id,b.id]]);
 const close=(uid,keep,over={})=>as(uid,`select close_missing_listings($1,$2::smallint,$3,$4,$5,$6::jsonb) n`,[over.world??'',over.channel??7,over.map??'Free Market 3',key(over.title??'Whole Shop'),over.title??'Whole Shop',JSON.stringify(keep)]);
 assert.equal((await close(B,[{item_id:Number(item),price:60,qty:1}]))[0].n,1,'one closed, by any player who saw the shop');
 let list=await as('',`select price from current_listings($1,'')`,[item]);assert.deepEqual(list.map(r=>Number(r.price)),[60]);
 const s=await stats(item);assert.equal(s.gone_listings,1);assert.equal(s.for_sale_now,1);assert.equal(s.sold_seen,0,'gone is not sold');assert.equal(s.listings,2,'it was still asked for');
 assert.equal((await db.query(`select count(*)::int n from listing_closures`)).rows[0].n,1,'recorded');
 assert.equal((await ask(A,{...place,price:50})).length,0,'seen again: the same listing');
 list=await as('',`select price from current_listings($1,'')`,[item]);assert.equal(list.length,2,'back on sale');
 await db.query(`update observations set last_seen_at=now()-interval '10 minutes' where id=any($1)`,[[a.id,b.id]]);
 assert.equal((await close(B,[],{channel:8}))[0].n,0,'another channel');assert.equal((await close(B,[],{map:'Free Market 4'}))[0].n,0,'another room');
 assert.equal((await close(B,[],{title:''}))[0].n,0,'an unread title proves nothing');assert.equal((await close(B,[],{title:'Totally Different'}))[0].n,0,'another shop');
 const fresh=await ask(A,{...place,price:77});assert.equal((await close(B,[{item_id:Number(item),price:50,qty:1},{item_id:Number(item),price:60,qty:1}]))[0].n,0,'a listing just published is left alone');
 await assert.rejects(as('',`select close_missing_listings('',7::smallint,'Free Market 3','x','Whole Shop','[]'::jsonb)`),/permission|sign-in/,'visitors cannot close listings');
 // Sold beats gone: a sold row stays sold, and stays out of the closing.
 await sold(A,{...place,price:60});await db.query(`update observations set last_seen_at=now()-interval '10 minutes' where id=$1`,[b.id]);
 assert.equal((await close(B,[{item_id:Number(item),price:50,qty:1},{item_id:Number(item),price:77,qty:1}]))[0].n,0,'nothing to close: 60 is sold');
 assert.ok((await db.query(`select sold_at from observations where id=$1`,[b.id])).rows[0].sold_at,'still sold');assert.equal((await db.query(`select gone_at from observations where id=$1`,[b.id])).rows[0].gone_at,null,'never gone');
 await assert.rejects(as(A,`update observations set gone_at=now() where id=${a.id}`),/permission|denied/,'gone_at is not writable directly');}

// Volume and sell-through, with enough listings to mean something.
{const item=await newItem('Fast Seller');for(let i=0;i<6;i++)await ask(A,{item:'Fast Seller',price:1000+i*10,title:shops[i],channel:i+1});for(let i=0;i<3;i++)await sold(B,{item:'Fast Seller',price:1000+i*10,title:shops[i],channel:i+1});
 const [r]=(await index()).filter(x=>x.name==='Fast Seller');assert.equal(Number(r.sold_seen),3);assert.equal(Number(r.sell_through_pct),50);assert.equal(Number(r.for_sale_now),3);
 const [few]=(await index()).filter(x=>x.name==='Work Gloves');assert.equal(few.sell_through_pct,null,'too few listings');}

// Flips: the lowest credible listing against seen-sold prices, after the fee; the basis is named.
{const item=await newItem('Cheap Find');for(let i=0;i<5;i++)await ask(A,{item:'Cheap Find',price:1000,title:shops[i],channel:i+10});for(let i=0;i<3;i++)await sold(B,{item:'Cheap Find',price:1000,title:shops[i],channel:i+10});
 await ask(A,{item:'Cheap Find',price:700,title:'Bargain Shop',channel:20});
 const rows=await as('',`select * from market_flips('',7,30)`),f=rows.find(r=>r.name==='Cheap Find');assert.ok(f,'found');assert.equal(Number(f.buy),700);assert.equal(Number(f.sell),1000);assert.equal(f.basis,'seen_sold');assert.equal(Number(f.samples),3);assert.equal(Number(f.profit),970-700,'3% fee taken');assert.ok(Math.abs(Number(f.roi_pct)-38.6)<.2);}
// A misread cheap price is no flip: it is below the credible range.
{const item=await newItem('Misread Trap');for(let i=0;i<5;i++)await ask(A,{item:'Misread Trap',price:1000,title:shops[i],channel:i+10});await ask(A,{item:'Misread Trap',price:10,title:'Typo Shop',channel:21});
 const f=(await as('',`select * from market_flips('',7,30)`)).find(r=>r.name==='Misread Trap');assert.equal(f,undefined,'no flip from a 100x misread, and the fee rules out the rest');}
// Too few listings: no target, so no flip.
{const item=await newItem('Thin Market');await ask(A,{item:'Thin Market',price:10});await ask(A,{item:'Thin Market',price:1000,title:'Shop B'});assert.equal((await as('',`select * from market_flips('',7,30)`)).find(r=>r.name==='Thin Market'),undefined);}

// Rankings: published on purpose, levels only rise, a name belongs to its publisher, and owners are not exposed.
{const pub=(uid,name,level,job='Cleric')=>as(uid,`select report_character('',$1,$2,$3)`,[name,job,level]);
 await pub(A,'Internaly',32);await pub(A,'internaly',33,'Priest');
 let [r]=await as('',`select * from public_rankings where lower(name)='internaly'`);assert.equal(r.level,33);assert.equal(r.job,'Priest');assert.equal('reporter' in r,false,'the publisher is private');
 await pub(A,'Internaly',20);[r]=await as('',`select level from public_rankings where lower(name)='internaly'`);assert.equal(r.level,33,'levels only rise');
 await assert.rejects(pub(B,'INTERNALY',50),/another player/,'nobody else can take the name');
 await assert.rejects(pub(A,'bad name!',10),/not valid/);await assert.rejects(pub(A,'Valid',500),/not valid/);
 await assert.rejects(as('',`select report_character('','Ghost','Cleric',10)`),/permission|sign-in/);
 await assert.rejects(as(A,`insert into character_rankings(world,name,job,level,reporter)values('','Direct','Cleric',200,'${A}')`),/permission|denied|row-level/,'only through the function');
 await assert.rejects(as(B,`select * from character_rankings`),/permission|denied/,'owners are not readable');
 assert.equal((await as(B,`select remove_character('Internaly','') r`))[0].r,false,'not yours');assert.equal((await as(A,`select remove_character('Internaly','') r`))[0].r,true);
 assert.equal((await as('',`select count(*)::int n from public_rankings`))[0].n,0);
 await pub(A,'Second',40);assert.equal((await as(ADMIN,`select remove_character('Second','') r`))[0].r,true,'an admin can remove one');}

// Alerts look at the best open listing of the last hour, not only the newest sighting.
{const item=await newItem('Alert Item');await db.exec(`update auth.users set email='a@example.test' where id='${A}'`);
 const events=async()=>as(A,`select price from price_alert_events order by created_at desc`);
 await as(A,`insert into watchlist(item_id,world,stats,threshold,direction)values($1,'','{}',1000,'below')`,[item]);
 const [cheap]=await ask(B,{item:'Alert Item',price:900,title:'Shop A',channel:31});await ask(B,{item:'Alert Item',price:2000,title:'Shop B',channel:32});
 assert.equal((await as(A,`select evaluate_price_alerts() n`))[0].n,1,'the cheap listing fires though a dearer one was read after it');
 assert.equal(Number((await events())[0].price),900);
 assert.equal((await as(A,`select evaluate_price_alerts() n`))[0].n,0,'once only');
 // A sold or gone listing fires nothing.
 const other=await newItem('Sold Alert');await as(A,`insert into watchlist(item_id,world,stats,threshold,direction)values($1,'','{}',500,'below')`,[other]);
 const [g]=await ask(B,{item:'Sold Alert',price:400,title:'Shop C',channel:33});await db.query(`update observations set gone_at=now() where id=$1`,[g.id]);
 assert.equal((await as(A,`select evaluate_price_alerts() n`))[0].n,0,'gone is not for sale');
 // Dearer than the mark, for a seller watching the other way.
 const up=await newItem('Up Alert');await as(A,`insert into watchlist(item_id,world,stats,threshold,direction)values($1,'','{}',5000,'above')`,[up]);await ask(B,{item:'Up Alert',price:6000,title:'Shop D',channel:34});await ask(B,{item:'Up Alert',price:100,title:'Shop E',channel:35});
 assert.equal((await as(A,`select evaluate_price_alerts() n`))[0].n,1);assert.equal(Number((await events())[0].price),6000);
 // Variants: a watch without stats matches any; a watch on a stat line only that line.
 const v=await newItem('Variant Alert','equip');await as(A,`insert into watchlist(item_id,world,stats,threshold,direction)values($1,'','{"watk":10}',800,'below')`,[v]);await ask(B,{item:'Variant Alert',price:700,title:'Shop F',channel:36});
 assert.equal((await as(A,`select evaluate_price_alerts() n`))[0].n,0,'another stat line');}

// Reporting a listing needs a row id.
{const [l]=await as('',`select * from current_listings($1,'')`,[potion]);assert.ok(Number(l.observation_id)>0);}
console.log('Market depth: windows, stale and repeat counts, outliers, gone listings, sell-through, flips and rankings passed.');
