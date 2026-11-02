// My Store on the supplied reference screenshot (Halloween NX store, 779x487): genuine Tesseract 6.0.1 output recorded by
// scripts/make-ocr-fixture.mjs. Regenerate the fixture with that script if the OCR pipeline changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tsvWords,locateRegions} from '../dist/locate.mjs';
import {parseTotal} from '../dist/detection.mjs';
import {previewRect,sourcePoint} from '../dist/capture-geometry.mjs';
import {parseSoldRecords,chooseSoldReading,chatVisitors,sameName,parsePriceList,listedPrice,netOf,unitPricesFor,verifySales,observeSoldItems,agreedNumber,STORE_FEE_RATE} from '../dist/sold-items.mjs';
import {createSession} from '../dist/store-session.mjs';

const fx=JSON.parse(fs.readFileSync(new URL('./fixtures/store-reference.ocr.json',import.meta.url),'utf8'));
const W=fx.width*fx.scale,H=fx.height*fx.scale;
const inside=(r,box,slack=6)=>r.x>=box.x-slack&&r.y>=box.y-slack&&r.x+r.w<=box.x+box.w+slack&&r.y+r.h<=box.y+box.h+slack;
const covers=(r,box)=>r.x<=box.x&&r.y<=box.y&&r.x+r.w>=box.x+box.w&&r.y+r.h>=box.y+box.h;
// Hand-measured from the screenshot: the three highlighted areas, and the content each must cover.
const BALANCE={x:133,y:148,w:100,h:23},BALANCE_DIGITS={x:180,y:152,w:48,h:14};
const SOLD={x:538,y:20,w:232,h:274},SOLD_TEXT={x:583,y:54,w:140,h:220};
const CHAT={x:237,y:172,w:291,h:224},CHAT_TEXT={x:251,y:183,w:200,h:195};

// ---- Auto Select: screen regions, not items ----
const original=locateRegions(tsvWords(fx.passes.original.tsv),W,H,fx.scale);
assert.equal(original.mode,'sold-items','reference layout has no Total Sales');
for(const [key,area,content] of [['items',SOLD,SOLD_TEXT],['chat',CHAT,CHAT_TEXT],['balance',BALANCE,BALANCE_DIGITS]]){
 const r=original[key];assert.ok(r,key+' found');
 assert.ok(inside(r,area),key+' stays inside its window: '+JSON.stringify(r));
 if(key!=='chat')assert.ok(covers(r,content),key+' covers its content: '+JSON.stringify(r));
}
assert.ok(original.chat.h>=CHAT_TEXT.h*.95&&original.chat.w>=150,'chat area covers the visible messages');
assert.equal(original.total,undefined,'no Sales total invented');
// Regions are in source pixels, so they map back onto a preview of any size (browser zoom, resized window).
for(const [pw,ph]of [[779,487],[389.5,243.5],[1558,974],[1000,625]]){
 const preview={x:10,y:20,width:pw,height:ph},r=original.items;
 const p=previewRect(r,preview,{width:fx.width,height:fx.height}),back=sourcePoint({x:p.x,y:p.y},preview,{width:fx.width,height:fx.height});
 assert.ok(Math.abs(back.x-r.x)<1e-6&&Math.abs(back.y-r.y)<1e-6,'round trip at preview '+pw);
}

// ---- Balance crop: "237,275" reads as "237.275" at 58-59% confidence in both passes ----
const [b1,b2]=fx.crops.balance.reads;
assert.equal(agreedNumber(b1,b2,parseTotal),237275,'two agreeing digit-group readings are accepted');
assert.equal(agreedNumber({text:'237.275',confidence:58},{text:'237.215',confidence:58},parseTotal),null,'disagreeing passes rejected');
assert.equal(agreedNumber({text:'237275',confidence:58},{text:'237275',confidence:58},parseTotal),null,'ungrouped low-confidence digits rejected');
assert.equal(agreedNumber({text:'5',confidence:40},{text:'5',confidence:40},parseTotal),null);

// ---- Sold Items crop ----
const [i1,i2]=fx.crops.items.reads;
const reading=chooseSoldReading(i1,i2);
assert.deepEqual(reading.records.map(r=>[r.name,r.qty]),[['Ghost Costume',1],['Black Shoes of Death',1],['Ghost Suit',1],[parseSoldRecords(i1.text)[3].name,1]]);
assert.deepEqual(reading.records.map(r=>r.agreed),[true,true,true,false],'"Scrall"/"Scroll" disagreement only distrusts that record');
assert.ok(reading.records[3].truncated,'"..." marks a cut-off name');
assert.equal(reading.records[0].buyer,'porkhoy');

// ---- Chat crop ----
const visitors=chatVisitors(fx.crops.chat.reads[0].text);
assert.ok(visitors.length>=12,'visitors read from enter/leave lines');
assert.ok(visitors.some(v=>sameName(v,'Ariaphis'))&&visitors.some(v=>sameName(v,'At0mic')),'OCR-tolerant name matching');
assert.ok(!sameName('porkboy','seanmarko')&&!sameName('Ssr1','Savagelife'));
assert.ok(sameName('porkhoy','porkboy')&&sameName('5sr1','Ssr1'));

// ---- Fees and prices ----
assert.deepEqual(netOf(20679),[20059,20058],'3% fee: floor and round/ceil candidates');
assert.ok(unitPricesFor(20059,1).includes(20679));
assert.deepEqual(unitPricesFor(0,1),[]);assert.deepEqual(unitPricesFor(100,0),[]);
const prices=parsePriceList('Ghost Suit = 20,679\nPumpkin Hat 22679\nCape Weapon Def. Scroll for Armor: 1,500,000\nbad line\nZero = 0');
assert.equal(prices.size,3);
assert.equal(listedPrice(prices,{name:'Ghost Suit'}),20679);
assert.equal(listedPrice(prices,{name:'Cape Weapon Def. Scroll...',truncated:true}),1500000,'unique prefix for a cut-off name');
assert.equal(listedPrice(prices,{name:'Ghost Costume'}),null);

// ---- Session: immutable baseline, verification and uncertain events ----
const rec=(name,buyer,qty=1,agreed=true)=>({name,buyer,qty,agreed,truncated:false,key:name.toLowerCase()+'|'+buyer.toLowerCase().replace(/0/g,'o').replace(/[1|!]/g,'l').replace(/5/g,'s')+'|'+qty});
const base=reading.records;
const step=(s,r)=>observeSoldItems(s,{confidence:72,feeRate:STORE_FEE_RATE,prices,visitors:[],...r});
let s=createSession('ref'),r=step(s,{balance:237275,records:base});
assert.equal(r.kind,'baseline');s=r.state;assert.equal(s.initialBalance,237275);assert.ok(Object.isFrozen(s));
assert.equal(step(s,{balance:237275,records:base}).kind,'unchanged','existing records are history, not sales');
// A Ghost Suit (listed 20,679) sells: the record and +20,059 must both be seen twice.
const sold=[rec('Ghost Suit','Newbuyer'),...base];
r=step(s,{balance:257334,records:sold});assert.equal(r.kind,'pending');
r=step(r.state,{balance:257334,records:sold});assert.equal(r.kind,'sale');assert.equal(r.method,'listed-price');
assert.deepEqual([r.sales[0].unitPrice,r.sales[0].gross,r.sales[0].net,r.sales[0].fee],[20679,20679,20059,620]);
s=r.state;assert.equal(s.initialBalance,237275,'starting balance never replaced');assert.equal(s.balanceRef,257334);
assert.equal(step(s,{balance:257334,records:sold}).kind,'unchanged','no duplicate event for the same record');
// Unrelated transaction: mesos drop with no record (e.g. bought a potion).
r=step(s,{balance:250000,records:sold});for(let i=0;i<3;i++)r=step(r.state,{balance:250000,records:sold});
assert.equal(r.kind,'balance-change');assert.equal(r.balanceChange,-7334);s=r.state;assert.equal(s.initialBalance,237275);
// Unlisted item: price derived from the balance only when the buyer was seen in chat.
const costume=[rec('Ghost Costume','Ariaphis'),...sold],net=netOf(20679)[0];
r=step(s,{balance:250000+net,records:costume});r=step(r.state,{balance:250000+net,records:costume});
assert.equal(r.kind,'uncertain','no listed price and buyer never seen');
r=step(createSession('chat'),{balance:250000,records:sold,visitors});r=step(r.state,{balance:250000+net,records:costume});r=step(r.state,{balance:250000+net,records:costume});
assert.equal(r.kind,'sale');assert.equal(r.method,'balance-and-chat');assert.ok(r.sales[0].unitPrice>=20678&&r.sales[0].unitPrice<=20680);
// Record without a balance increase (scrolled into view) waits, then stays uncertain.
r=step(createSession('scroll'),{balance:1000,records:base});const scrolled=[rec('Old Hat','Someone'),...base];
for(let i=0;i<2;i++){r=step(r.state,{balance:1000,records:scrolled});assert.equal(r.kind,'pending');}
r=step(r.state,{balance:1000,records:scrolled});assert.equal(r.kind,'pending');r=step(r.state,{balance:1000,records:scrolled});
assert.equal(r.kind,'uncertain');assert.match(r.reason,/did not increase/);
// Mismatched amount, several sales at once, a one-pass record, OCR interruption.
assert.equal(verifySales([rec('Ghost Suit','x')],20000,{prices}).verified,false);
const two=verifySales([rec('Ghost Suit','x'),rec('Pumpkin Hat','y')],netOf(20679)[0]+netOf(22679)[0],{prices});
assert.equal(two.verified,true);assert.equal(two.sales.length,2);
assert.equal(verifySales([rec('Ghost Suit','x'),rec('Ghost Costume','y')],40000,{prices,visitors:['x','y']}).verified,false,'unpriced multi-sale is not split');
assert.equal(verifySales([rec('Ghost Suit','x',1,false)],20059,{prices}).verified,false);
assert.equal(verifySales([rec('Ghost Suit','x')],-5,{prices}).verified,false);
r=step(s,{balance:null,records:sold});assert.equal(r.kind,'unreadable');assert.equal(r.state.balanceRef,s.balanceRef,'interruption keeps state');
assert.equal(step(s,{balance:257334,records:sold,confidence:20}).kind,'unreadable');
console.log('Reference store screenshot: Auto Select finds balance, Sold Items and chat; balance 237,275 read; records, visitors, fee-checked sales, unrelated transactions and uncertain events passed.');

// ---- Community scanner on the same frame: it is the player's own store, so nothing is submitted as an FM listing ----
import {readShop} from '../dist/shop.mjs';
for(const [name,pass]of Object.entries(fx.passes)){
 const shop=readShop(tsvWords(pass.tsv));
 if(name==='original')assert.equal(shop.ownStore,true,'scanner pass recognises own-store controls ("SOLOITERS", "CLOS STORE")');
 assert.deepEqual(shop.listings.map(l=>[l.item,l.price]),[['Tiger Mask',19679],['Grey Skull Overall',20679],['Pumpkin Hat',22679]],name+': active listings only; greyed sold-out rows skipped');
}
assert.equal(readShop([{text:'Buy',x:10,y:10,w:20,h:10,confidence:90}]).ownStore,false);
console.log('Scanner on the reference frame: correct asking prices, sold-out rows skipped, own store recognised and not shared.');
