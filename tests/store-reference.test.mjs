// My Store on the supplied reference screenshot (Halloween NX store, 779x487): genuine Tesseract 6.0.1 output recorded by
// scripts/make-ocr-fixture.mjs. Regenerate the fixture with that script if the OCR pipeline changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Jimp} from 'jimp';
import {tsvWords,locateRegions,coinScorer} from '../dist/locate.mjs';
import {parseTotal} from '../dist/detection.mjs';
import {previewRect,sourcePoint} from '../dist/capture-geometry.mjs';
import {chooseSoldReading,chatVisitors,sameName,parsePriceList,listedPrice,netOf,unitPricesFor,verifySales,observeSoldItems,agreedNumber,majorityNumber,STORE_FEE_RATE} from '../dist/sold-items.mjs';
import {createSession} from '../dist/store-session.mjs';

const fx=JSON.parse(fs.readFileSync(new URL('./fixtures/store-reference.ocr.json',import.meta.url),'utf8'));
const W=fx.width*fx.scale,H=fx.height*fx.scale;
// Frame pixels as the browser has them: the screenshot upscaled nearest-neighbour by the OCR scale.
const framePixels=async(image,scale)=>{const i=image.clone().resize({w:Math.round(image.bitmap.width*scale),h:Math.round(image.bitmap.height*scale),mode:'nearestNeighbor'});return{data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height};};
const referenceImage=await Jimp.read(fileURLToPath(new URL('./fixtures/store-reference.png',import.meta.url)));
const locate=(f,px)=>locateRegions(tsvWords(f.passes.original.tsv),f.width*f.scale,f.height*f.scale,f.scale,coinScorer(px,f.scale),px);
const inside=(r,box,slack=6)=>r.x>=box.x-slack&&r.y>=box.y-slack&&r.x+r.w<=box.x+box.w+slack&&r.y+r.h<=box.y+box.h+slack;
const covers=(r,box)=>r.x<=box.x&&r.y<=box.y&&r.x+r.w>=box.x+box.w&&r.y+r.h>=box.y+box.h;
// The user's placements, measured inside the green and red outlines drawn on the screenshot, and the content each must cover.
// Chat follows the user's later placement on the live store: the white message area and the input line, without the scrollbar.
const BALANCE={x:134,y:147,w:96,h:26},BALANCE_DIGITS={x:180,y:152,w:48,h:14};
const SOLD={x:538,y:27,w:226,h:266},SOLD_TEXT={x:583,y:54,w:140,h:220};
const CHAT={x:243,y:170,w:262,h:250},CHAT_TEXT={x:251,y:183,w:200,h:195};

// ---- Auto Select: screen regions, not items ----
const original=locate(fx,await framePixels(referenceImage,fx.scale));
assert.equal(original.mode,'sold-items','reference layout has no Total Sales');
const near=(r,box,slack=2)=>['x','y','w','h'].every(k=>Math.abs(r[k]-box[k])<=slack);
for(const [key,area,content] of [['items',SOLD,SOLD_TEXT],['chat',CHAT,CHAT_TEXT],['balance',BALANCE,BALANCE_DIGITS]]){
 const r=original[key];assert.ok(r,key+' found');
 assert.ok(near(r,area),key+' matches the user placement: '+JSON.stringify(r));
 // OCR reads only the text area: inside the window, clear of icons, scrollbar and chat input, and covering every line.
 const text=r.text||r;assert.ok(inside(text,area,r.text?0:2),key+' text area stays inside the window');
 assert.ok(covers(text,content),key+' text area covers its content: '+JSON.stringify(text));
}
assert.ok(original.items.text.x>=578&&original.items.text.x+original.items.text.w<=740,'item icons and scrollbar excluded from OCR');
assert.deepEqual(original.sale,{x:SOLD.x,y:SOLD.y,w:SOLD.w,h:SOLD.h},'sale snapshot is the Sold Items window');
// The same placements at 150% UI scale (display scaling or a resized capture): the screenshot resized with Jimp's bilinear filter,
// recreated here so the pixels match the recorded OCR.
{const big=JSON.parse(fs.readFileSync(new URL('./fixtures/store-reference-150.ocr.json',import.meta.url),'utf8'));
 const scaled=referenceImage.clone().resize({w:Math.round(referenceImage.bitmap.width*1.5),h:Math.round(referenceImage.bitmap.height*1.5),mode:'bilinearInterpolation'});
 const r=locate(big,await framePixels(scaled,big.scale));
 const at=(b,k=1.5)=>({x:Math.round(b.x*k),y:Math.round(b.y*k),w:Math.round(b.w*k),h:Math.round(b.h*k)});
 for(const [key,area] of [['items',SOLD],['chat',CHAT],['balance',BALANCE]])assert.ok(r[key]&&near(r[key],at(area),3),key+' follows the UI scale: '+JSON.stringify(r[key])+' vs '+JSON.stringify(at(area)));
 assert.ok(covers(r.items.text,at(SOLD_TEXT))&&covers(r.chat.text,at(CHAT_TEXT)),'scaled text areas cover their content');}
// The user's live store (Trash), cropped from their annotated screenshot: Sold Items detached on the right, UI at ~0.78x and
// blurred by resampling, "Buyer:" lines garbled and "CLOSE STORE" unread. Boxes are the user's green (mesos) and red (chat).
{const live=JSON.parse(fs.readFileSync(new URL('./fixtures/store-live-small.ocr.json',import.meta.url),'utf8'));
 const image=await Jimp.read(fileURLToPath(new URL('./fixtures/store-live-small.png',import.meta.url)));
 const r=locate(live,await framePixels(image,live.scale)),edges=(a,b,slack)=>Math.abs(a.x-b.x)<=slack&&Math.abs(a.y-b.y)<=slack&&Math.abs(a.x+a.w-b.x-b.w)<=slack&&Math.abs(a.y+a.h-b.y-b.h)<=slack;
 assert.equal(r.mode,'sold-items');
 assert.ok(r.chat&&edges(r.chat,{x:189,y:120,w:200,h:199},10),'live chat matches the user placement: '+JSON.stringify(r.chat));
 assert.ok(covers(r.chat.text,{x:195,y:139,w:150,h:146}),'live chat text area covers all messages');
 assert.ok(r.balance&&edges(r.balance,{x:113,y:105,w:63,h:26},7)&&covers(r.balance,{x:146,y:115,w:30,h:9}),'live mesos matches the user placement: '+JSON.stringify(r.balance));
 assert.ok(r.items&&r.items.y<=22&&covers(r.items.text,{x:449,y:38,w:90,h:170}),'live Sold Items starts at the first entry (Metal Koif): '+JSON.stringify(r.items));}
assert.equal(original.total,undefined,'no Sales total invented');
// Regions are in source pixels, so they map back onto a preview of any size (browser zoom, resized window).
for(const [pw,ph]of [[779,487],[389.5,243.5],[1558,974],[1000,625]]){
 const preview={x:10,y:20,width:pw,height:ph},r=original.items;
 const p=previewRect(r,preview,{width:fx.width,height:fx.height}),back=sourcePoint({x:p.x,y:p.y},preview,{width:fx.width,height:fx.height});
 assert.ok(Math.abs(back.x-r.x)<1e-6&&Math.abs(back.y-r.y)<1e-6,'round trip at preview '+pw);
}

// ---- Balance crop: "237,275", bicubic-upscaled (ocr-prep.mjs), three passes ----
assert.equal(majorityNumber(fx.crops.balance.reads,parseTotal),237275,'agreeing digit-group readings are accepted');
assert.ok(fx.crops.balance.reads.every(r=>r.confidence>=80),'smooth upscaling reads the digits confidently');
assert.equal(agreedNumber({text:'237.275',confidence:58},{text:'237.215',confidence:58},parseTotal),null,'disagreeing passes rejected');
assert.equal(agreedNumber({text:'237275',confidence:58},{text:'237275',confidence:58},parseTotal),null,'ungrouped low-confidence digits rejected');
assert.equal(agreedNumber({text:'5',confidence:40},{text:'5',confidence:40},parseTotal),null);
assert.equal(majorityNumber([{text:'246,309',confidence:69},{text:'258,809',confidence:90},{text:'258,809',confidence:88}],parseTotal),258809,'two of three passes decide');
assert.equal(majorityNumber([{text:'256,809',confidence:70},{text:'246,309',confidence:69},{text:'258,809',confidence:88}],parseTotal),null,'no two passes agree');

// ---- Sold Items crop ----
const reading=chooseSoldReading(...fx.crops.items.reads);
assert.deepEqual(reading.records.map(r=>[r.name,r.buyer,r.qty]),[['Ghost Costume','porkboy',1],['Black Shoes of Death','MuleRook',1],['Ghost Suit','Ssr1',1],['Cape Weapon Def. Scroll...','Fuehrer',1]]);
assert.ok(reading.complete&&reading.records.every(r=>r.agreed),'every record read the same way by at least two passes');
assert.ok(reading.records[3].truncated,'"..." marks a cut-off name');
// One-character OCR slips still agree; a different record does not.
const slip=chooseSoldReading({text:'Cape Weapon Def. Scrall\nBuyer: Fuehrer\nNumber purchased: 1',confidence:80},{text:'Cape Weapon Def. Scroll\nBuyer: Fuehrer\nNumber purchased: 1',confidence:80});
assert.ok(slip.records[0].agreed,'"Scrall"/"Scroll" is one record');
const other=chooseSoldReading({text:'Ghost Suit\nBuyer: Ssr1\nNumber purchased: 1',confidence:80},{text:'Ghost Costume\nBuyer: Ssr1\nNumber purchased: 1',confidence:80});
assert.deepEqual(other.records.map(r=>r.agreed),[false],'different items are not merged');
assert.equal(chooseSoldReading({text:'Ghost Suit\nBuyer: Ssr1\nNumber purchased: 2',confidence:80},{text:'Ghost Suit\nBuyer: Ssr1\nNumber purchased: 1',confidence:80}).records[0].agreed,false,'quantities must match exactly');

// ---- The user's live store (small, blurred UI): mesos and Sold Items as shown in the screenshot ----
{const live=JSON.parse(fs.readFileSync(new URL('./fixtures/store-live-small.ocr.json',import.meta.url),'utf8'));
 assert.equal(majorityNumber(live.crops.balance.reads,parseTotal),258809,'live mesos 258,809');
 const sold=chooseSoldReading(...live.crops.items.reads),truth=[['Metal Koif','MYMYFem'],['Work Gloves','bobo8'],['Silver Wind Shoes','Cryru'],['Lemona','XiaoPaCai']];
 assert.deepEqual(sold.records.map(r=>r.name),truth.map(t=>t[0]),'live item names exact');
 assert.ok(sold.complete,'all live records trusted');
 assert.ok(sold.records.every((r,i)=>sameName(r.buyer,truth[i][1])),'live buyers within OCR tolerance: '+sold.records.map(r=>r.buyer).join(', '));
 assert.ok(chatVisitors(live.crops.chat.reads[0].text).filter(v=>['RosyHunter','Depredator09','Sandyyy','nomaster','Rath'].includes(v)).length>=10,'live chat names exact');}

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
assert.equal(step(s,{balance:257334,records:[rec('Ghost Suit','Newbuyar'),...base]}).kind,'unchanged','a one-letter misread of a known record is not a new sale');
assert.equal(listedPrice(prices,{name:'Ghost Sult'}),20679,'listed price found despite an OCR slip');
assert.equal(listedPrice(parsePriceList('Blue Potion = 50\nBlue Lotion = 60'),{name:'Blue Motion'}),null,'ambiguous near matches are not guessed');
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

const emptyFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/store-empty-sold.ocr.json',import.meta.url),'utf8'));
const emptyImage=await Jimp.read(fileURLToPath(new URL('./fixtures/store-empty-sold.png',import.meta.url)));
const emptyPixels=await framePixels(emptyImage,emptyFixture.scale);
const emptyRegions=locateRegions(tsvWords(emptyFixture.tsv),emptyPixels.width,emptyPixels.height,emptyFixture.scale,coinScorer(emptyPixels,emptyFixture.scale),emptyPixels);
assert.equal(emptyRegions.mode,'sold-items');
assert.ok(inside(emptyRegions.balance,{x:640,y:370,w:140,h:40}), 'personal mesos stays in the field under Close Store');
assert.ok(covers(emptyRegions.balance,{x:717,y:382,w:48,h:14}), 'personal mesos includes 78,721');
assert.ok(inside(emptyRegions.items,{x:1150,y:200,w:310,h:370}), 'empty Sold Items stays inside its window');
assert.ok(covers(emptyRegions.items,{x:1220,y:330,w:190,h:200}), 'empty Sold Items includes the rows below totals');
assert.ok(covers(emptyRegions.storeItems,{x:545,y:420,w:190,h:185}), 'store list includes all four listed items');
