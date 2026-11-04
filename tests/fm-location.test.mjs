// Free Market location and store-list publishing reads, on the user's screenshots (tests/fixtures/store-fm-*.png) and the real
// Tesseract output recorded by scripts/make-fm-fixture.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Jimp} from 'jimp';
import {tsvWords} from '../dist/locate.mjs';
import * as fm from '../dist/fm-location.mjs';
import {listingKey,readShop} from '../dist/shop.mjs';

const fx=JSON.parse(fs.readFileSync(new URL('./fixtures/store-fm.ocr.json',import.meta.url),'utf8'));
const pixels=async name=>{const i=await Jimp.read(fileURLToPath(new URL('./fixtures/'+name,import.meta.url)));return{data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height};};
const room=await pixels(fx.room.source),channel=await pixels(fx.channel.source);

// ---- FM room from the expanded minimap in the top-left corner ----
const line=fm.findRoomLine(fm.toSource(tsvWords(fx.room.find),fx.room.corner,fm.ROOM_FIND.scale));
assert.ok(line&&line.x<150&&line.y<80,'"Free Market" line found in the corner: '+JSON.stringify(line&&line.text));
assert.deepEqual(fm.roomLineCrop(line,room.width,room.height),fx.room.lineCrop,'crop geometry matches the recording');
assert.equal(fm.agreedRoom(fx.room.reads),8,'room 8 from agreeing reads: '+fx.room.reads.map(t=>t.trim()).join(' / '));
assert.equal(fm.parseRoom('Free Market <g>'),null,'a misread digit is not guessed');
assert.equal(fm.parseRoom('F1ee Market <8>'),8,'a misread "Free" still gives the room');
// The title panel from pixels at any capture size: the reference, display scaling 1.5x and 2x, and the game inside a
// 1920x1080 full-screen share below a 32px title bar. The line crop is where the reference one is, scaled and shifted.
const scaled=async(s,canvas)=>{const i=await Jimp.read(fileURLToPath(new URL('./fixtures/'+fx.room.source,import.meta.url)));if(s!==1)i.resize({w:Math.round(i.bitmap.width*s),h:Math.round(i.bitmap.height*s)});
 if(!canvas)return{data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height};const c=new Jimp({width:1920,height:1080,color:0x202020ff});c.composite(i,0,32);return{data:c.bitmap.data,width:1920,height:1080};};
for(const [s,canvas,dy] of [[1,false,0],[1.5,false,0],[2,false,0],[1,true,32]]){
 const px=await scaled(s,canvas),found=fm.roomLine(px,fm.roomCorner(px.width,px.height)),ref=fx.room.lineCrop,label=s+'x'+(canvas?' in 1080p':'');
 assert.ok(found,'minimap title panel found at '+label);
 assert.ok(Math.abs(found.crop.x-ref.x*s)<=4*s&&Math.abs(found.crop.y-ref.y*s-dy)<=4*s&&Math.abs(found.crop.w-ref.w*s)<=8*s,'line crop at '+label+': '+JSON.stringify(found.crop));
 assert.ok(found.h>=7*s&&found.h<=10*s,'text height at '+label+': '+found.h);
}
assert.deepEqual(fm.roomLineReads(8).map(o=>o.scale),[5,6,7,8]);
assert.deepEqual(fm.roomLineReads(16).map(o=>o.scale),[2,3,4,4]);
assert.equal(fm.roomLine(channel,fm.roomCorner(channel.width,channel.height))?.crop?.w>0,true,'the channel screenshot has the minimap too');
assert.equal(fm.parseRoom('Hidden Street Free Market <12>'),12);
assert.equal(fm.agreedRoom(['Free Market <8>','Free Market <9>']),null,'disagreeing reads give no room');

// ---- World and channel from the Change Channel menu ----
const grid=fm.channelGrid(channel);
assert.ok(grid,'channel grid found');
assert.deepEqual([grid.columns,grid.rows,grid.channel],[8,5,35],'the blue cell is CH.35 of an 8x5 grid');
assert.equal(fm.channelGrid(room),null,'no channel menu on screen, no channel');
assert.equal(fm.parseWorld(fx.channel.worldReads[0]),'Windia','world from the menu header: '+fx.channel.worldReads[0].trim());
assert.equal(fm.locationText({world:'Windia',channel:35,room:8}),'Windia · Ch 35 · FM 8');

// ---- Store title and list: sold rows are greyed out ----
assert.equal(fm.storeTitle(fm.toSource(tsvWords(fx.room.title.tsv),fx.room.title.area,fm.TITLE_READ.scale)),'Trash');
const rows=fm.mergeStoreRows(fx.room.list.reads.map((t,i)=>fm.parseStoreRows(fm.toSource(tsvWords(t),fx.room.list.area,fm.LIST_READS[i].scale))),room);
assert.deepEqual(rows.map(r=>[r.item.toLowerCase(),r.qty,r.price,r.sold]),[
 ['orange potion',1,125,true],['orange potion',1,124,true],['lemona',1,1679,true],['work gloves',1,1679,true],
 ['sapphire earrings',1,7679,false],['silver wind shoes',1,1679,true]],'every row of the screenshot, with sold state');
// The FM scanner's test on other players' shops: grey ink is sold, dark ink is for sale, a box on blank background is neither.
const flat=(bg,ink)=>{const d=new Uint8ClampedArray(40*10*4).fill(bg);if(ink!==null)for(let x=10;x<30;x++){const p=(5*40+x)*4;d[p]=d[p+1]=d[p+2]=ink;}return{data:d,width:40,height:10};};
const whole={x:0,y:0,w:40,h:10};
assert.equal(fm.isSold(flat(244,190),whole),true,'grey text: sold');
assert.equal(fm.isSold(flat(244,20),whole),false,'dark text: for sale');
assert.equal(fm.isSold(flat(244,null),whole),false,'empty background: not a sold row');
assert.notEqual(listingKey({item:'Lemona',price:1679,stats:{}}),listingKey({item:'Lemona',price:1679,stats:{},sold:true}),'a row turning grey is a new observation');
assert.deepEqual(fm.parsePriceLine('100 for 5,000 mesos'),{qty:100,qtyKnown:true,bundle:5000,price:50},'bundles give a unit price');
assert.deepEqual(fm.parsePriceLine('110r1,679 mesos'),{qty:1,qtyKnown:false,bundle:1679,price:1679},'"1 for" misread: the price still parses');
assert.equal(fm.parsePriceLine('Sapphire Earrings'),null);

// ---- Automatic publishing of the store list: every row checked, uncertain ones skipped ----
// Real Tesseract re-reads of each price line (scripts/make-fm-price-fixture.mjs): all six rows verify, with their look.
const priceFx=JSON.parse(fs.readFileSync(new URL('./fixtures/store-fm-prices.json',import.meta.url),'utf8'));
const checked=rows.map(r=>{const k=r.item+'@'+Math.round(r.box.y),f=priceFx[k];assert.ok(f,'price reads recorded for '+k);
 const state=fm.rowState(room,fm.rowNameBox(r),r.priceBox);assert.equal(state,f.state);return[r.item.toLowerCase(),state,fm.agreedPrice(r,f.texts)?.price??null];});
assert.deepEqual(checked,[['orange potion','sold',125],['orange potion','sold',124],['lemona','sold',1679],['work gloves','sold',1679],['sapphire earrings','active',7679],['silver wind shoes','sold',1679]]);
assert.deepEqual(['1 for 125 mesos','1for 125','11or124 mesos','110r1,679 mesos','1 or 1,679 mesos','4 1 1for 125 mesos','11 for 500 mesos','100 for 5,000 mesos','110124 mesos','Lemona'].map(fm.readQty),[1,1,1,1,1,1,11,100,null,null],'quantity from misread "for"');
const row125={bundle:125};
assert.equal(fm.agreedPrice(row125,['1 for 125 mesos','1 for 126 mesos','110124 mesos']),null,'no two reads agree: skipped');
assert.equal(fm.agreedPrice(row125,['1 for 126 mesos','1 for 126 mesos']),null,'reads agree with each other but not with the list reading: skipped');
assert.equal(fm.agreedPrice(row125,['125 mesos','125 mesos']),null,'quantity never read: skipped, not assumed');
assert.deepEqual(fm.agreedPrice({bundle:5000},['100 for 5,000 mesos','100for 5,000 mesos']),{qty:100,bundle:5000,price:50});
// Sync: repeated scans refresh, a for-sale row turning grey becomes sold, sold history is never removed, relisting adds a row.
const pub=[{id:'a',item_id:1,qty:1,price:125,stats:{},sold:false},{id:'b',item_id:2,qty:1,price:1679,stats:{},sold:true},{id:'c',item_id:3,qty:1,price:50,stats:{},sold:false}];
assert.deepEqual(fm.planListingSync(pub,[{item_id:1,qty:1,price:125,sold:false},{item_id:2,qty:1,price:1679,sold:true}]),
 {updates:[{id:'a',patch:{sold:false,active:true},nowSold:false},{id:'b',patch:{sold:true,active:true},nowSold:false}],inserts:[]},'the same scan again: no new listings');
assert.deepEqual(fm.planListingSync(pub,[{item_id:1,qty:1,price:125,sold:true}]).updates,[{id:'a',patch:{sold:true,active:true},nowSold:true}],'unsold to sold: the listing is updated');
assert.deepEqual(fm.planListingSync(pub,[{item_id:2,qty:1,price:1679,sold:false}]),{updates:[],inserts:[{item_id:2,qty:1,price:1679,sold:false}]},'relisted after it sold: the sold row stays, a new one is added');
assert.deepEqual(fm.planListingSync(pub,[{item_id:1,qty:1,price:130,sold:false}]).inserts.length,1,'another price is another listing');

// ---- Row state from how the row is drawn (the FM Scanner's test): name and price lines must agree ----
const nameOf=r=>({x:r.priceBox.x,y:r.box.y,w:r.box.x+r.box.w-r.priceBox.x,h:r.priceBox.y-r.box.y});
assert.deepEqual(rows.map(r=>fm.rowState(room,nameOf(r),r.priceBox)),['sold','sold','sold','sold','active','sold'],'greyed rows sold, Sapphire Earrings active, on the screenshot');
// The scanner's padded boxes from readShop on the same rows.
const scanned=readShop(fm.toSource(tsvWords(fx.room.list.reads[0]),fx.room.list.area,fm.LIST_READS[0].scale)).listings;
assert.ok(scanned.length&&scanned.every(l=>fm.rowState(room,l.nameBox,l.priceBox)==='sold'),'scanner boxes: '+scanned.map(l=>l.item).join(', '));
// Synthetic rows: grey name over a dark price, a mid-grey neither sold nor for sale, and a coloured (not grey) faint line.
const rowPx=(nameInk,priceInk,tint=0)=>{const d=new Uint8ClampedArray(60*24*4).fill(244);const ink=(y,v)=>{for(let x=8;x<52;x++){const p=(y*60+x)*4;d[p]=v;d[p+1]=v;d[p+2]=Math.min(255,v+tint);}};for(const y of [4,5,6])ink(y,nameInk);for(const y of [15,16,17])ink(y,priceInk);return{data:d,width:60,height:24};};
const nb={x:0,y:0,w:60,h:10},pb={x:0,y:12,w:60,h:10};
assert.equal(fm.rowState(rowPx(200,200),nb,pb),'sold');
assert.equal(fm.rowState(rowPx(30,30),nb,pb),'active');
assert.equal(fm.rowState(rowPx(200,30),nb,pb),'uncertain','grey name, dark price: uncertain');
assert.equal(fm.rowState(rowPx(140,140),nb,pb),'uncertain','mid grey: uncertain');
assert.equal(fm.rowState(rowPx(190,190,60),nb,pb),'uncertain','faint but coloured text is not the sold grey');
assert.equal(fm.rowState({data:new Uint8ClampedArray(60*24*4).fill(244),width:60,height:24},nb,pb),'uncertain','empty boxes: uncertain');

// ---- The minimap's map line: FM room, named map, or nothing ----
assert.deepEqual(fm.readMapLine(['Free Market <7>','Free Market <7>','Free Market <>','Free Market <7>']),{locationType:'FM_ROOM',roomNumber:7,mapName:null,confidence:75});
assert.equal(fm.readMapLine(['Free Market <12>','Free Market <12>']).roomNumber,12);
assert.equal(fm.readMapLine(['Free Market <>','Free Market <>'],['Free Market <8>','Free Market <8>']),null,'an FM line with no readable number is not a named map');
assert.equal(fm.readMapLine(['Free Market <7>','Free Market <1>']),null,'disagreeing digits: unknown, never guessed');
assert.deepEqual(fm.readMapLine(['re a','ree'],['Hidden Street','Hidden Street','Hiden Stret']),{locationType:'NAMED_MAP',roomNumber:null,mapName:'Hidden Street',confidence:67});
assert.equal(fm.readMapLine(['',''],['Hidden Street','Henesys']),null,'named map reads must agree');
assert.equal(fm.locationText({world:'Windia',channel:2,mapName:'Hidden Street'}),'Windia · Ch 2 · Hidden Street');
console.log('FM location: room 8 from the minimap, Windia channel 35 from the menu grid, store "Trash" with 5 sold and 1 for-sale rows, sold/active/uncertain rows and FM room vs named map passed.');
