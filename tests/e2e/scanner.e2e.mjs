// The FM Scanner and Store Watcher end to end, in a real browser, on a real capture, with real in-browser OCR and the real SQL behind it.
// The capture shows the player's own store, which the scanner must refuse. With the owner-only buttons painted out it is what a shop
// looks like to a visitor, so the same real pixels drive the whole path: rows, sold and unsold, room, channel, publishing, duplicates.
//   node tests/e2e/scanner.e2e.mjs [chrome|msedge] [--shots dir]
import os from 'node:os';import path from 'node:path';import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {serve,launch,newPage,checks} from './harness.mjs';
import {createMock,HOST} from './mock-rest.mjs';

const channel=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'chrome',shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
process.on('unhandledRejection',e=>{if(e?.name!=='TargetClosedError')throw e;});
const dir=process.env.E2E_FRAMES=path.join(os.tmpdir(),'mw-e2e-frames-scanner');fs.mkdirSync(dir,{recursive:true});
const fixture=n=>fileURLToPath(new URL('../fixtures/'+n+'.png',import.meta.url));
// A panel-coloured patch over the Sold Items / Open Store / Close Store buttons: the only thing that tells the owner's view apart.
const visitor=async(name,box,out)=>{const i=await Jimp.read(fixture(name)),W=i.bitmap.width,d=i.bitmap.data;for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const p=(y*W+x)*4;d[p]=214;d[p+1]=212;d[p+2]=204;}await i.write(path.join(dir,out+'.png'));};
await visitor('store-fm-room',{x:468,y:185,w:78,h:66},'shop');
await visitor('store-fm-channel',{x:460,y:178,w:78,h:54},'shop-channel');
fs.copyFileSync(fixture('store-fm-room'),path.join(dir,'own-store.png'));fs.copyFileSync(fixture('store-empty-sold'),path.join(dir,'store-window.png'));

const mock=await createMock(),c=checks();
const config={prices:{supabaseUrl:HOST,supabaseAnonKey:'anon-key'},items:{iconBase:'https://osmsdataexplorer.com/data/current/images/items/'}};
const server=await serve({config}),browser=await launch(channel),errors=[];
console.log(`FM Scanner end to end · ${channel} ${browser.version()}`);
const q=(sql,args)=>mock.serial(()=>mock.db.query(sql,args));
for(const name of ['Orange Potion','Lemona','Work Gloves','Sapphire Earrings','Silver Wind Shoes'])await q(`insert into items(name,game_id,verified,source,release_status,category)values($1,$2,true,'catalog','released','etc')`,[name,1000000+Math.floor(Math.random()*8e6)]);
// Earlier sightings give Sapphire Earrings a market to be compared with. They are marked, so what the scanner adds can be told from them.
const other=await mock.addUser();
for(const [i,price] of [9000,9500,10000].entries())await mock.as(other.id,()=>mock.db.query(`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)values('ask','','Sapphire Earrings',$1,1,$2,$2,'Free Market 3',$3,'scanner','FM_ROOM',3,'AUTO',90)`,[price,'Seed '+i,i+1]));
const page=await newPage(browser,{url:server.url+'/#scanner',errors,mock});
const shot=async name=>{if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,channel+'-'+name+'.png'),fullPage:true});}};
const show=n=>page.evaluate(x=>window.__capture.show('/__frames/'+x+'.png'),n);
const text=id=>page.locator('#'+id).textContent();
const until=(id,want,timeout=90000)=>page.waitForFunction(([i,w])=>document.getElementById(i)?.textContent.includes(w),[id,want],{timeout,polling:200});

await c.step('scanning needs sharing and the agreement first',async()=>{
 await page.waitForSelector('[data-view="scanner"]:not([hidden])');assert.equal(await page.isDisabled('#scan-toggle'),true);
 await show('own-store');await page.click('#scan-connect');await until('scan-status','Tick the sharing agreement');assert.equal(await page.isDisabled('#scan-toggle'),true);
 await page.check('#scan-consent');assert.equal(await page.isDisabled('#scan-toggle'),false);
});
await c.step('the player’s own store is refused, and nothing is published',async()=>{
 await page.selectOption('#scan-interval','4');await page.click('#scan-toggle');await until('scan-status','your own store');
 assert.equal((await q(`select count(*)::int n from observations where shop_title not like 'Seed%'`)).rows[0].n,0);
});
await c.step('a shop is read, with sold rows told apart, and waits for its channel',async()=>{
 await show('shop');await page.waitForFunction(()=>document.getElementById('scan-channel-dialog').open,null,{timeout:120000});
 assert.match(await text('scan-status'),/Open Change Channel/);await page.click('#scan-channel-dialog button');
 await page.locator('.scan-location-details').evaluate(d=>{d.open=true;});
 assert.ok(+(await text('scan-d-sold'))>=3,'rows seen sold: '+await text('scan-d-sold'));assert.ok(+(await text('scan-d-active'))>=1,'rows for sale: '+await text('scan-d-active'));
 assert.equal(await page.inputValue('#scan-room'),'8','the room comes from the minimap');
 assert.equal((await q(`select count(*)::int n from observations where shop_title not like 'Seed%'`)).rows[0].n,0,'nothing goes out without a channel');
 await until('scan-check','Typical asking price 9,500 mesos each');
 assert.match(await text('scan-check'),/Sapphire Earrings/,'a live price check needs no channel');
 await shot('scanner-waiting');
});
await c.step('with the channel read from its grid, listings publish with their location',async()=>{
 await show('shop-channel');await until('scan-status','Shared',120000);
 const asks=(await q(`select item_name,price,channel,room,map,location_type,location_source,kind,shop_title from observations where shop_title not like 'Seed%'`)).rows;
 assert.ok(asks.length>=1,'an asking price was published');
 const earrings=asks.find(a=>a.item_name==='Sapphire Earrings');assert.ok(earrings,'Sapphire Earrings: '+JSON.stringify(asks));
 assert.equal(Number(earrings.price),7679);assert.equal(earrings.channel,35);assert.equal(earrings.room,8);assert.equal(earrings.map,'Free Market 8');assert.equal(earrings.location_type,'FM_ROOM');assert.equal(earrings.location_source,'AUTO');
 assert.equal(asks.some(a=>a.item_name==='Lemona'),false,'a greyed-out row is never an asking price');
 const sold=(await q(`select item_name,listed_price,channel,room from sold_sightings`)).rows;assert.ok(sold.length>=3,'sold rows published as sightings: '+JSON.stringify(sold));
 assert.ok(sold.every(s=>s.channel===35&&s.room===8));assert.equal(sold.some(s=>s.item_name==='Sapphire Earrings'),false,'an active row is never sold');
 assert.ok(sold.some(s=>s.item_name==='Lemona'&&Number(s.listed_price)===1679));
 assert.match(await text('scan-feed'),/Sapphire Earrings/);await shot('scanner-shared');
 return `${asks.length} asking, ${sold.length} sold`;
});
await c.step('reading the same shop again adds nothing',async()=>{
 const count=async()=>[(await q(`select count(*)::int n from observations`)).rows[0].n,(await q(`select count(*)::int n from sold_sightings`)).rows[0].n];
 const before=await count();await show('shop');await page.waitForTimeout(13000);assert.deepEqual(await count(),before);
});
await c.step('a listing published here shows on its item page, with where to find it',async()=>{
 const id=(await q(`select id from items where name='Sapphire Earrings'`)).rows[0].id;
 await page.evaluate(h=>{location.hash=h;},'#item/'+id);await page.waitForSelector('#ip-listings tr');
 assert.match(await page.locator('#ip-listings').textContent(),/CH 35 • FM Room 8/);await page.evaluate(()=>{location.hash='#scanner';});
});
await c.step('the browser ending the share stops scanning and releases the capture',async()=>{
 await page.evaluate(()=>window.__capture.end());await until('scan-status','Window sharing ended');assert.equal(await page.evaluate(()=>window.__capture.liveTracks()),0);
 assert.match(await text('scan-toggle'),/Start scanning/);
});
await c.step('Store Watcher still reads the balance, and offers the manual fallback for what it cannot find',async()=>{
 await show('own-store');await page.evaluate(()=>{location.hash='#store';});await page.waitForSelector('[data-view="store"]:not([hidden])');
 await page.click('#connect');await until('balance-reading','258,809',120000);await until('status','manually',60000);
 assert.equal(await page.isDisabled('#start'),true,'Start still waits for every required step');
 assert.equal(await page.isDisabled('#select-storeItems'),false,'the manual selection is available');
 await shot('store-watcher');
});
await c.step('Store Watcher compares its own item with the market for the selected world',async()=>{
 const name='Overall Armor DEX Scroll';
 await q(`insert into items(name,game_id,verified,source,release_status,category) values($1,2040402,true,'catalog','released','use')`,[name]);
 for(const [i,price] of [18000,20000,22000].entries())await mock.as(other.id,()=>mock.db.query(`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)values('ask','Windia',$1,$2,1,$3,$3,'Free Market 3',$4,'scanner','FM_ROOM',3,'AUTO',90)`,[name,price,'Seed scroll '+i,i+1]));
 await page.evaluate(()=>localStorage.setItem('mw-fm-world','Windia'));
 await page.reload();
 await show('store-window');
 await page.click('#connect');
 await page.waitForFunction(()=>!document.getElementById('fm-read-store').disabled,null,{timeout:90000});
 await page.click('.watcher-guide button[aria-controls="publish-step"]');
 await page.click('#fm-read-store');
 await until('fm-items','Typical asking price 20,000 mesos each');
 const card=await page.locator('#fm-items li').filter({hasText:name}).textContent();
 assert.match(card,/FM Scanner.*3 listings/);
});
await c.step('no page errors',async()=>{assert.deepEqual(errors,[]);});
await page.context().close();await browser.close();await server.close();
if(!c.summary())process.exit(1);
process.exit(0);
