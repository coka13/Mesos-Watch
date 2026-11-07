// The market end to end: the real pages against the real SQL (see mock-rest.mjs), with data put in the way scanners do, through the
// database's own triggers and rules. Run with: node tests/e2e/market.e2e.mjs [chrome|msedge] [--shots dir]
import os from 'node:os';import path from 'node:path';import fs from 'node:fs';
import assert from 'node:assert/strict';
import {serve,launch,newPage,checks} from './harness.mjs';
import {createMock,HOST} from './mock-rest.mjs';
import {writeFrames} from './frames.mjs';

const channel=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'chrome',shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
process.on('unhandledRejection',e=>{if(e?.name!=='TargetClosedError')throw e;});
const dir=process.env.E2E_FRAMES=path.join(os.tmpdir(),'mw-e2e-frames-market');
await writeFrames(dir,{start:{exp:49732,pct:40.51}});
const mock=await createMock(),c=checks();
const config={prices:{supabaseUrl:HOST,supabaseAnonKey:'anon-key'},items:{iconBase:'https://osmsdataexplorer.com/data/current/images/items/'}};
const server=await serve({config}),browser=await launch(channel),errors=[];
console.log(`Market end to end · ${channel} ${browser.version()}`);

// ---- Data, entered as scanners enter it ----
const [ann,ben,buyer]=[await mock.addUser(),await mock.addUser(),await mock.addUser('buyer@example.test')];
const q=(sql,args)=>mock.serial(()=>mock.db.query(sql,args));
const item=async(name,category='use')=>(await q(`insert into items(name,game_id,verified,source,release_status,category)values($1,$2,true,'catalog','released',$3)returning id`,[name,1000000+Math.floor(Math.random()*8e6),category])).rows[0].id;
const key=(t,room)=>t?`|free market ${room}|${t}`.toLowerCase():'';
const ask=(u,{name,price,title,channel=1,room=8,qty=1})=>mock.as(u.id,()=>mock.db.query(`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)
 values('ask','',$1,$2,$3,$4,$5,$6,$7,'scanner','FM_ROOM',$8,'AUTO',90)returning id`,[name,price,qty,key(title,room),title,'Free Market '+room,channel,room]));
const sold=(u,{name,price,title,channel=1,room=8})=>mock.as(u.id,()=>mock.db.query(`insert into sold_sightings(world,channel,location_type,room,location_source,shop_key,shop_title,item_name,listed_price,qty)values('',$1,'FM_ROOM',$2,'AUTO',$3,$4,$5,$6,1)`,[channel,room,key(title,room),title,name,price]));
const shops=['Potion Stop','Cheap Stars','Meso Bazaar','Lucky Corner','Trader Joe','Maple Mart'];
const potion=await item('Orange Potion'),gloves=await item('Work Gloves','equip'),scroll=await item('Scroll for Testing','use'),rare=await item('Rare Earrings','equip'),old=await item('Old Relic','etc');
for(const [i,p] of [120,125,130,140,150].entries())await ask(ann,{name:'Orange Potion',price:p,title:shops[i],channel:i+1});
await ask(ben,{name:'Orange Potion',price:120,title:shops[0],channel:1});
await ask(ann,{name:'Orange Potion',price:2,title:'Typo Shop',channel:7});
for(let i=0;i<3;i++)await sold(ben,{name:'Orange Potion',price:[125,130,140][i],title:shops[i+1],channel:i+2});
for(const [i,p] of [1000,1000,1100,1200].entries())await ask(ann,{name:'Work Gloves',price:p,title:shops[i],channel:i+11});
await ask(ann,{name:'Work Gloves',price:600,title:'Bargain Bin',channel:20});
await ask(ann,{name:'Rare Earrings',price:50000,title:shops[0],channel:21});await ask(ann,{name:'Rare Earrings',price:90000,title:shops[1],channel:22});
{const [o]=(await ask(ann,{name:'Old Relic',price:7000,title:'Attic Shop',channel:30})).rows;await q(`update observations set seen_at=now()-interval '20 days',last_seen_at=now()-interval '20 days' where id=$1`,[o.id]);}

const page=await newPage(browser,{url:server.url+'/',errors,mock});
const shot=async(p,name)=>{if(shots){fs.mkdirSync(shots,{recursive:true});await p.screenshot({path:path.join(shots,channel+'-'+name+'.png'),fullPage:true});}};
const text=(id,p=page)=>p.locator('#'+id).textContent();
const until=(id,want,p=page,timeout=20000)=>p.waitForFunction(([i,w])=>document.getElementById(i)?.textContent.includes(w),[id,want],{timeout,polling:150});
const go=async(hash,p=page)=>{await p.evaluate(h=>{location.hash=h;},hash);await p.waitForTimeout(150);};

await c.step('the home page shows what was scanned, and real counts',async()=>{
 await page.waitForSelector('#home-feed li:not(.empty)');assert.match(await text('home-feed'),/Orange Potion|Work Gloves/);
 await until('home-stats','Listings seen');assert.equal(await page.isHidden('#config-missing'),true);
});
await c.step('search finds items by name and opens their page',async()=>{
 await page.fill('#q','orange');await page.waitForSelector('#q-list li[role="option"]');
 assert.match(await text('q-list'),/Orange Potion/);await page.keyboard.press('Enter');await until('ip-name','Orange Potion');
});
await c.step('an item page shows lowest, typical and what they rest on',async()=>{
 await page.waitForFunction(()=>/\d/.test(document.querySelector('#k-median strong').textContent));
 assert.match(await page.locator('#k-median').textContent(),/Middle half/);assert.match(await page.locator('#k-median').textContent(),/Source: FM Scanner/);
 const low=await page.locator('#k-low strong').getAttribute('title').catch(()=>null);
 assert.match(await page.locator('#k-low').textContent(),/120/,'the misread 2 does not set the lowest price: '+low);
 const depth=await text('ip-depth');assert.match(depth,/6 listings in 7 d/);assert.match(depth,/1 repeat sighting counted once/);assert.match(depth,/1 unusual price left out of the lowest/);assert.match(depth,/3 seen sold/);
});
await c.step('listings show where to buy, flag the misread, and filter and sort',async()=>{
 const rows=page.locator('#ip-listings tr');assert.equal(await rows.count(),3,'three of the six listings were seen sold');
 assert.match(await rows.first().textContent(),/CH \d+ • FM Room 8/);assert.match(await page.locator('#ip-listings').textContent(),/Check price/);
 await page.fill('#ip-f-channel','5');await page.waitForTimeout(100);assert.equal(await rows.count(),1,'channel filter');await page.fill('#ip-f-channel','');
 await page.selectOption('#ip-listing-sort','recent');await page.selectOption('#ip-listing-sort','price');
 assert.match(await text('ip-sold'),/SOLD/);assert.match(await text('ip-sold-src'),/Typical listed price of sold rows/);
 assert.ok(await page.locator('#ip-chart svg').count()===1,'price chart');await page.click('#ip-ranges button[data-range="30d"]');await page.waitForTimeout(300);
 await shot(page,'item');
});
await c.step('the profit calculator starts from the page’s own prices',async()=>{
 assert.equal(await page.inputValue('#trade-buy'),'120');assert.equal(await page.inputValue('#trade-fee'),'3');
 await page.fill('#trade-sell','200');await until('trade-output','Net profit');assert.match(await text('trade-output'),/74/,'200 less 3% less 120');assert.match(await text('trade-output'),/61\.7%/);
 await page.fill('#trade-buy','-5');await until('trade-note','whole');await page.fill('#trade-buy','120');
});
await c.step('choosing a longer window changes the figures',async()=>{
 await go('#item/'+old);await until('ip-name','Old Relic');await page.waitForFunction(()=>document.getElementById('ip-depth').textContent.includes('0 listings'));
 await page.selectOption('#ip-window','30');await until('ip-depth','1 listing in 30 d');assert.match(await page.locator('#k-median span').first().textContent(),/30 d/);
 await page.selectOption('#ip-window','7');await until('ip-depth','0 listings in 7 d');
});
await c.step('too few listings say so instead of showing a price',async()=>{
 await go('#item/'+rare);await until('ip-name','Rare Earrings');await page.waitForFunction(()=>document.getElementById('k-median').textContent.includes('Insufficient data'));
 assert.match(await page.locator('#k-median').textContent(),/2 listings this week; needs 3/);
});
await c.step('Market Trends: four tabs on one page, no new navigation',async()=>{
 await go('#trends');await page.waitForSelector('#market-index-rows tr');
 {const tabs=await page.locator('.view[data-view="trends"] .route-tabs button').allTextContents();assert.deepEqual(tabs,['Market index','Rising & falling','Buy low, sell high','Your alerts'],JSON.stringify(tabs));}
 assert.equal(await page.locator('#nav a').count(),7,'Companion is the only new navigation entry');
 await shot(page,'trends');
});
await c.step('the market index shows windows, counts and honest gaps',async()=>{
 const row=name=>page.locator('#market-index-rows tr',{hasText:name});
 assert.equal(await page.locator('#market-index-rows tr').count(),3,'three items have data in 7 days');
 const potionRow=await row('Orange Potion').textContent();assert.match(potionRow,/\d/);
 assert.match(await row('Rare Earrings').textContent(),/Insufficient data/);
 assert.match(await text('market-index-note'),/unusual price/);
 await page.selectOption('#market-window','30');await page.waitForFunction(()=>document.querySelectorAll('#market-index-rows tr').length===4);assert.ok(await row('Old Relic').count()===1,'older item in 30 days');
 await page.selectOption('#market-window','7');await page.waitForFunction(()=>document.querySelectorAll('#market-index-rows tr').length===3);
});
await c.step('filtering, type and best match work together',async()=>{
 await page.fill('#market-filter','gloves');await page.waitForFunction(()=>document.querySelectorAll('#market-index-rows tr').length===1);
 assert.equal(await page.inputValue('#market-sort'),'best','typing a name sorts by best match');
 await page.fill('#market-filter','');await page.selectOption('#market-sort','forsale');
 await page.selectOption('#market-category','equip');await page.waitForFunction(()=>document.querySelectorAll('#market-index-rows tr').length===2);
 await page.selectOption('#market-category','');
 for(const [sort,first] of [['forsale','Work Gloves'],['volume','Orange Potion'],['high','Work Gloves'],['low','Orange Potion'],['recent',null],['soldprice','Orange Potion'],['listed','Orange Potion']]){
  await page.selectOption('#market-sort',sort);await page.waitForTimeout(60);
  if(first)assert.match(await page.locator('#market-index-rows tr').first().textContent(),new RegExp(first),'sort '+sort);
 }
 await page.selectOption('#market-sort','forsale');
});
await c.step('buy low, sell high names its basis, after the fee, and ignores misreads',async()=>{
 await page.click('[data-view="trends"] .route-tabs button:has-text("Buy low")');await page.waitForSelector('#flips-rows tr');
 const rows=await text('flips-rows');assert.match(rows,/Work Gloves/);assert.match(rows,/asking median/);assert.match(rows,/stats may differ/,'equipment warning');
 assert.doesNotMatch(rows,/Orange Potion.*\b2\b mesos/,'a misread is no bargain');assert.match(await text('flips-note'),/3% store fee/);
 await shot(page,'flips');
});
await c.step('alerts need an account, and say so',async()=>{
 await page.click('[data-view="trends"] .route-tabs button:has-text("Your alerts")');await until('alerts-note','Sign in');assert.equal(await page.isVisible('#alerts-signin'),true);
 await page.click('#alerts-signin');await page.waitForSelector('.sign-in-box input[type="email"]');
 await page.fill('.sign-in-box input[type="email"]','someone@example.test');await page.click('.sign-in-box button');await page.waitForFunction(()=>document.querySelector('.sign-in-box .status')?.textContent.includes('Check your email'));
});
await c.step('a database failure is explained, and the page recovers',async()=>{
 await page.click('[data-view="trends"] .route-tabs button:has-text("Market index")');mock.fail('market_index_window');
 await page.selectOption('#market-window','14');await until('market-index-note','Simulated database failure');
 mock.fail(null);await page.selectOption('#market-window','7');await page.waitForSelector('#market-index-rows tr');assert.doesNotMatch(await text('market-index-note'),/failure/);
 errors.length=0;
});
await c.step('reporting needs an account, explained in place',async()=>{
 await go('#item/'+potion);await page.waitForSelector('#ip-listings .link-button');await page.locator('#ip-listings .link-button').first().click();
 await page.waitForSelector('#report-dialog[open]');await until('report-status','need an account');assert.equal(await page.isDisabled('#report-send'),true);await page.click('#report-cancel');
});
const signedIn=await (async()=>{const context=await browser.newContext({viewport:{width:1366,height:900}}),p=await context.newPage();await mock.attach(p);await mock.signIn(p,buyer);p.on('pageerror',e=>errors.push('pageerror: '+e.message));await p.addInitScript(()=>{window.__noop=1;});await p.goto(server.url+'/#item/'+gloves);return p;})();
await c.step('a signed-in player sets an alert from an item page',async()=>{
 const p=signedIn;await until('ip-name','Work Gloves',p);await p.waitForFunction(()=>document.getElementById('ip-alert-price').value!=='');
 await p.fill('#ip-alert-price','500');await p.click('#ip-alert-form button');await until('ip-alert-note','Alert set',p);
 const rows=(await q(`select threshold from watchlist`)).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].threshold),500);
});
await c.step('the alert fires once on a listing at the price, on any page, until dismissed',async()=>{
 const p=signedIn;await ask(ben,{name:'Work Gloves',price:450,title:'Lucky Find',channel:25});
 await go('#trends',p);await p.click('[data-view="trends"] .route-tabs button:has-text("Your alerts")');await p.waitForSelector('#alerts-rows tr');
 await p.waitForSelector('#alert-banner:not([hidden]) .alert-hit');assert.match(await text('alert-banner',p),/Work Gloves/);assert.match(await text('alert-banner',p),/450/);
 assert.match(await text('alerts-rows',p),/Work Gloves/);
 await go('#stores',p);await p.waitForTimeout(200);assert.equal(await p.isVisible('#alert-banner'),true,'still shown elsewhere');
 await p.click('#alert-banner button');await p.waitForSelector('#alert-banner',{state:'hidden'});
 assert.equal((await q(`select count(*)::int n from price_alert_events`)).rows[0].n,1,'once');assert.equal((await q(`select count(*)::int n from price_alert_events where read_at is not null`)).rows[0].n,1);
});
await c.step('alerts can be edited and removed',async()=>{
 const p=signedIn;await go('#trends',p);await p.click('[data-view="trends"] .route-tabs button:has-text("Your alerts")');await p.waitForSelector('#alerts-rows tr');
 await p.fill('#alerts-rows .alert-price','300');await p.click('#alerts-rows button:has-text("Save")');await p.waitForFunction(()=>document.getElementById('alerts-rows').textContent.includes('Saved'));
 assert.equal(Number((await q(`select threshold from watchlist`)).rows[0].threshold),300);
 await p.click('#alerts-rows button:has-text("Remove")');await p.waitForSelector('#alerts-empty:visible');assert.equal((await q(`select count(*)::int n from watchlist`)).rows[0].n,0);
});
await c.step('a signed-in player reports a listing',async()=>{
 const p=signedIn;await go('#item/'+potion,p);await p.waitForSelector('#ip-listings .link-button');await p.locator('#ip-listings .link-button').first().click();await p.waitForSelector('#report-dialog[open]');
 await p.fill('#report-reason','short');await p.click('#report-send');await until('report-status','at least 10',p);
 await p.fill('#report-reason','This price is a misread of the shop.');await p.click('#report-send');await until('report-status','sent for review',p);await p.click('#report-cancel');
 assert.equal((await q(`select count(*)::int n from market_reports where observation_id is not null`)).rows[0].n,1);
});
await signedIn.context().close();
await c.step('site admin: nothing shows to a player, and an admin can review',async()=>{
 const admin=await mock.addUser('admin@example.test');await q(`insert into admins values($1)`,[admin.id]);
 const seller=await mock.addUser('seller@example.test');
 await mock.as(seller.id,()=>mock.db.query(`insert into observations(kind,world,item_name,price,qty,capture_source)values('sale','','Orange Potion',135,1,'store')`));
 await q(`insert into megaphones(message,sender,world,plan_id,minutes,price_cents,status,buyer,paid_at,livemode)select 'WTS Orange Potions','Tester','',p.id,p.minutes,p.price_cents,'paid_pending_review',$1,now(),false from megaphone_plans p where p.active limit 1`,[buyer.id]).catch(e=>console.log('    (no queue row: '+e.message+')'));
 const open=async p=>{await p.waitForSelector('[data-view="settings"]:not([hidden])');await p.locator('#site-admin').evaluate(d=>{d.open=true;});};
 await go('#settings');await open(page);await until('adm-state','Only site admins');assert.equal(await page.isHidden('#adm-panel'),true,'hidden from visitors');assert.equal(await page.isVisible('#adm-login'),true);
 await page.locator('#site-admin').evaluate(d=>{d.open=false;});
 const context=await browser.newContext({viewport:{width:1366,height:900}}),p=await context.newPage();await mock.attach(p);await mock.signIn(p,admin);p.on('pageerror',e=>errors.push('pageerror: '+e.message));await p.goto(server.url+'/#settings');await open(p);
 await until('adm-state','(admin)',p);await p.waitForSelector('#adm-panel:not([hidden])');
 await p.waitForFunction(()=>document.getElementById('admin-market-reports').textContent.includes('misread'));
 await p.fill('#admin-market-reports input','Checked against the shop, price was fine.');await p.click('#admin-market-reports button:has-text("Dismiss")');await until('admin-market-reports','No open reports',p);
 assert.equal((await q(`select status from market_reports`)).rows[0].status,'dismissed');
 await p.waitForFunction(()=>document.getElementById('admin-sale-reviews').textContent.includes('Orange Potion'));
 await p.fill('#admin-sale-reviews textarea','Seller showed the Sold Items record and the fee-adjusted balance.');await p.click('#admin-sale-reviews button:has-text("Verify")');await until('admin-sale-reviews','No reported sales',p);
 assert.equal((await q(`select verification_status from observations where kind='sale'`)).rows[0].verification_status,'verified');
 await p.waitForSelector('#adm-sponsors',{state:'attached',timeout:8000});
 if(shots)await p.screenshot({path:path.join(shots,channel+'-admin.png'),fullPage:true});
 await context.close();
 const stranger=await browser.newContext(),s=await stranger.newPage();await mock.attach(s);await mock.signIn(s,buyer);await s.goto(server.url+'/#settings');await open(s);await until('adm-state','not an admin',s);assert.equal(await s.isHidden('#adm-panel'),true,'a player sees no panel');await stranger.close();
});
await c.step('rankings publish a character read from the status bar, on purpose only',async()=>{
 await go('#companion');await page.waitForSelector('#rk-empty:visible');assert.ok((await text('rk-rows')).trim()==='' ,'empty to begin with');
 assert.ok(await page.locator('#rk-job option').count()>=15,'jobs come from the game data');
 await page.evaluate(()=>window.__capture.show('/__frames/start.png'));await page.click('#cp-connect');await until('cp-level','32',page,120000);await until('cp-job','Cleric',page,60000);
 await page.locator('details:has(#rk-name)').evaluate(d=>{d.open=true;});await page.fill('#rk-name','');await page.fill('#rk-name','Internaly');
 await page.waitForFunction(()=>!document.getElementById('rk-publish').disabled,null,{timeout:10000});
 assert.equal((await q(`select count(*)::int n from character_rankings`)).rows[0].n,0,'nothing is published by tracking alone');
 await page.click('#rk-publish');await until('rk-note','on the rankings at level 32');await until('rk-rows','Internaly');assert.match(await text('rk-rows'),/Cleric/);
 await page.selectOption('#rk-job','Hunter');await page.waitForSelector('#rk-empty:visible');await page.selectOption('#rk-job','');await until('rk-rows','Internaly');
 await page.click('#rk-remove');await until('rk-note','removed');await page.waitForSelector('#rk-empty:visible');
 await page.click('#cp-stop');
});
await c.step('the owner’s notice shows on every page',async()=>{
 await q(`insert into site_settings(key,value)values('site_notice','Game maintenance until 18:00. Scanning resumes after.')`);await page.reload();
 await until('site-notice','Game maintenance');await go('#stores');assert.equal(await page.isVisible('#site-notice'),true);
 await q(`delete from site_settings where key='site_notice'`);
});
await c.step('a page left open is told about a new version',async()=>{
 await page.reload();await page.waitForTimeout(600);assert.equal(await page.isHidden('#update-banner'),true,'no banner without an update');
 const html=fs.readFileSync('dist/index.html','utf8').replace('site.css?v=','site.css?v=next-');
 await page.route(server.url+'/',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForSelector('#update-banner:visible');
 await page.unroute(server.url+'/');await Promise.all([page.waitForNavigation(),page.click('#update-reload')]);await page.waitForTimeout(400);assert.equal(await page.isHidden('#update-banner'),true);
});
await c.step('every route opens, and every link inside the site leads somewhere',async()=>{
 const views=await page.$$eval('main>.view',v=>v.map(x=>x.dataset.view));
 for(const v of views){await go('#'+v);assert.equal(await page.evaluate(()=>document.body.dataset.view),v);await page.waitForTimeout(80);}
 const dead=await page.evaluate(v=>[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(h=>{const head=h.slice(1).split('/')[0];return h!=='#'&&!v.includes(head)&&!['item','main-content','watcher','sale-activity','support','discord','guide','prices'].includes(head);}),views);
 assert.deepEqual([...new Set(dead)],[],'no dead links');
});
await c.step('no page scrolls sideways on a phone',async()=>{
 const phone=await newPage(browser,{url:server.url+'/',viewport:{width:390,height:844},errors,mock});
 const bad=[];
 for(const v of ['checker','trends','scanner','store','companion','stores','megaphones','settings','history']){await go('#'+v,phone);await phone.waitForTimeout(250);const over=await phone.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);if(over>1)bad.push(v+' +'+over+'px');}
 await go('#item/'+potion,phone);await phone.waitForSelector('#ip-listings tr');const over=await phone.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);if(over>1)bad.push('item +'+over+'px');
 await go('#trends',phone);await phone.waitForTimeout(400);await shot(phone,'mobile-trends');await go('#companion',phone);await phone.waitForTimeout(400);await shot(phone,'mobile-companion');
 await phone.context().close();assert.deepEqual(bad,[]);
});
await c.step('the maple leaves fall, and stay still for anyone who asks for less motion',async()=>{
 assert.equal(await page.locator('.maple-fall i').count(),8);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.maple-fall i')).animationName),'leaf-drop');
 const ok=await page.evaluate(async()=>{const urls=[...new Set([...document.querySelectorAll('.maple-fall i')].map(l=>getComputedStyle(l).backgroundImage.slice(5,-2)))];return Promise.all(urls.map(u=>fetch(u).then(r=>r.ok)));});assert.ok(ok.length===2&&ok.every(Boolean),'both leaf pictures load');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.maple-fall')).pointerEvents),'none','clicks pass through');
 const still=await browser.newContext({reducedMotion:'reduce'}),p=await still.newPage();await p.goto(server.url+'/');await p.waitForSelector('.maple-fall i',{state:'attached'});
 assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.maple-fall i')).animationName),'none');await still.close();
});
await c.step('no page errors',async()=>{assert.deepEqual(errors,[]);});
await page.context().close();await browser.close();await server.close();
if(!c.summary())process.exit(1);
process.exit(0);
