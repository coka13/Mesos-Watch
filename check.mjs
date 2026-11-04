import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseTotal,observe,itemNames,cleanItemText,chooseItemReading} from './dist/detection.mjs';
import {locateRegions,tsvWords,rowsOf,frameScale} from './dist/locate.mjs';
import {readShopListings,readShop,confirmed,averageHash,shopKeyOf,parsePriceLine} from './dist/shop.mjs';
assert.equal(parseTotal('1,250,000\n'),1250000);
assert.equal(parseTotal('1.250.000'),1250000);
assert.equal(parseTotal('Total 123'),null);
assert.equal(parseTotal(''),null);
assert.equal(parseTotal('13,679\n13,269'),null);
assert.equal(parseTotal('13679 13269'),null);
assert.equal(parseTotal('13,679'),13679);
const mixed='| Overall Armor INT Scroll: Gr...\nBuyer: Imhanmeimei\nMurmber purchased: 1\nTotal Sales / Total Received\n13,679 mesos 13,269 mesos';
assert.equal(cleanItemText(mixed),'Overall Armor INT Scroll: Gr...');
assert.deepEqual(itemNames('',mixed),['Overall Armor INT Scroll: Gr...']);
assert.equal(cleanItemText('Buyer: OtherPlayer\nNumber purchased: 1\nTotal Sales / Total Received\n13,679 mesos'),'');
assert.equal(cleanItemText('Overall Armor INT Scroll Buyer: Player Number purchased: 1 Total Sales 13,679'),'Overall Armor INT Scroll');
const reported='[Ee\nCrwerall Armor INT Scroll: Gr... LJ\nSo Buyer: Imhanrmeirme ;\nMurnber purchased: 1 p\nTotal Sales f Total Received :\noO 13,679 mesos fe\n13,269 mesos\n9';
// Remove UI debris without inventing a correction for the misread item name.
assert.equal(cleanItemText(reported),'Crwerall Armor INT Scroll: Gr...');
assert.equal(cleanItemText('Cwerall Armor INT Scroll: Gr... = |\nSo Buyer: Name |\nHumber purchased: 1\nTotal Sales f Total Received'),'Cwerall Armor INT Scroll: Gr...');
assert.equal(chooseItemReading({text:'Overall Armor INT Scroll',confidence:92},{text:'Crwerall Armor INT Scroll',confidence:90}).itemReliable,false);
assert.equal(chooseItemReading({text:'Overall Armor INT Scroll',confidence:92},{text:'Overall Armor INT Scroll',confidence:90}).items,'Overall Armor INT Scroll');
assert.equal(chooseItemReading({text:'Overall Armor INT Scroll',confidence:40},{text:'Overall Armor INT Scroll',confidence:90}).items,'');
let s={total:null,items:'',candidate:null};
let r=observe(s,{total:100,items:'Old Item 100',confidence:90});assert.equal(r.kind,'baseline');s=r.state;
r=observe(s,{total:200,items:'Old Item 100\nNew Item 100',confidence:90});assert.equal(r.kind,'pending');s=r.state;
r=observe(s,{total:200,items:'Old Item 100\nNew Item 100',confidence:90});assert.equal(r.kind,'sale');assert.equal(r.amount,100);assert.deepEqual(r.names,['New Item']);s=r.state;
assert.equal(observe(s,{total:200,items:'',confidence:90}).kind,'unchanged');
assert.equal(observe(s,{total:0,items:'',confidence:90}).kind,'reset');
assert.equal(observe(s,{total:300,items:'',confidence:40}).kind,'unreadable');
assert.deepEqual(itemNames('Potion 10','Potion 10\nPotion 10'),['Potion']);
assert.equal(observe({...s,candidate:'300|Item'},{total:null,items:'Item',confidence:90}).state.candidate,null);
let uncertain=observe(s,{total:300,items:'',itemReliable:false,confidence:95});
uncertain=observe(uncertain.state,{total:300,items:'',itemReliable:false,confidence:95});
assert.equal(uncertain.kind,'sale');assert.deepEqual(uncertain.names,[]);
console.log('Detection checks passed: parsing, stable changes, duplicates, low confidence, and resets.');
let group=0;
const line=(y,parts)=>{group++;return parts.map(([text,x,w=35])=>({text,x,y,w,h:12,confidence:95,group:String(group)}));};
const words=[...line(50,[['Sold',400],['Items',440]]),...line(200,[['Total',400],['Sales',440],['/',480,10],['Total',510],['Received',550,65]]),...line(225,[['13,679',405,55],['mesos',463,40],['13,269',520,55]]),...line(350,[['50,615',90,60]])];
let located=locateRegions(words,1000,700,1,w=>w.x===90?.2:0);
assert.ok(located.total&&located.items&&located.balance);
assert.equal(located.total.x,403);assert.equal(located.balance.x,88);
assert.deepEqual(locateRegions([],1000,700),{});
const ambiguous=[...words,...line(390,[['99,999',90,60]])];
assert.equal(locateRegions(ambiguous,1000,700,1,w=>w.x===90?.2:0).balance,undefined);
assert.equal(tsvWords('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t95\tSold')[0].text,'Sold');
console.log('Auto-location checks passed: shop anchors, total, separate balance, missing and ambiguous fields.');
// Shop listings, laid out as in a real store window (Cheap Halloween NX): name row, then "N for X mesos" row.
const words2=s=>{let x=0;return s.split(' ').map(t=>{const w=[t,x,t.length*7];x+=t.length*7+4;return w;});};
const at=(y,x0,text,confidence=95)=>line(y,words2(text).map(([t,x,w])=>[t,x0+x,w])).map(w=>({...w,confidence}));
const shopWords=[
 ...at(18,20,'Cheap Halloween NX'),
 ...at(160,46,'Grey Skull Overall'),...at(178,46,'1 for 24,679 mesos'),
 ...at(200,46,'Tiger Mask'),...at(218,46,'1 for 23,679 mesos'),
 ...at(240,46,'Ghost Costume'),...at(258,46,'1 for 20,679 mesos'),
 ...at(280,46,'Pumpkin Hat'),...at(298,46,'5 for 100,000 mesos'),
 ...at(320,46,'Ghost Suit',50),...at(338,46,'1 for 19,679 mesos'),
 ...at(165,242,'FIAA has entered.'),...at(180,242,'Sold 1 for 5,000 mesos earlier'),
 ...at(36,573,'Overall Armor INT Scroll: Gr...'),...at(52,573,'Buyer: Imhanmeimei'),...at(68,573,'Number purchased: 1'),
 ...at(108,573,'13,679 mesos')];
const listings=readShopListings(shopWords);
assert.deepEqual(listings,[{item:'Grey Skull Overall',price:24679,qty:1},{item:'Tiger Mask',price:23679,qty:1},{item:'Ghost Costume',price:20679,qty:1},{item:'Pumpkin Hat',price:20000,qty:5}]);
assert.deepEqual(readShopListings([]),[]);
assert.deepEqual(readShopListings([...at(165,242,'Bob : wts'),...at(180,242,'1 for 5,000 mesos ok')]),[]);
assert.deepEqual(readShopListings([...at(165,242,'Bob : wts'),...at(180,242,'1 for 5,000 mesos')]),[]);
assert.deepEqual(readShopListings([...at(160,46,'Tiger Mask'),...at(178,46,'1 for 23,679 mesos',40)]),[]);
assert.deepEqual(confirmed(listings,[{item:'tiger mask',price:23679,qty:1},{item:'Tiger Mask',price:23000,qty:1}]),[{item:'tiger mask',price:23679,qty:1}]);
console.log('Shop listing checks passed: names, per-item prices, bundles, low confidence, chat and sold-items lines ignored.');
// Auto Select against the user's 756x460 store screenshot (Cheap Halloween NX). Every word is its own Tesseract group,
// as sparse mode (psm 11) often returns, and Total Sales / Total Received are stacked, not side by side.
{
 let g=1000;const solo=(y,x0,text,confidence=95)=>{let x=x0;return text.split(' ').map(t=>{const w={text:t,x,y,w:t.length*6.5,h:12,confidence,group:String(g++)};x+=w.w+4;return w;});};
 const shot=[
  ...solo(18,20,'Cheap Halloween NX'),...solo(62,150,'SOLD ITEMS'),...solo(92,148,'OPEN STORE'),...solo(112,146,'CLOSE STORE'),
  ...solo(138,40,'Internaly'),...solo(137,133,'50,615'),
  ...solo(157,46,'Grey Skull Overall'),...solo(174,46,'1 for 24,679 mesos'),...solo(197,46,'Tiger Mask'),...solo(214,46,'1 for 23,679 mesos'),
  ...solo(165,242,'FIAA has entered.'),...solo(180,242,'FIAA has left the room.'),
  ...solo(32,573,'Overall Armor INT Scroll: Gr...'),...solo(48,573,'Buyer: Imhanmeimei'),...solo(65,573,'Number purchased: 1'),
  ...solo(94,573,'Total Sales / Total Received'),...solo(110,573,'13,679 mesos'),...solo(127,573,'13,269 mesos'),
  ...solo(424,33,'Please be aware that a 3% fee'),...solo(440,33,'will be deducted from sales.')];
 const coin=w=>w.text==='50,615'?.3:0;
 assert.equal(rowsOf(shot).find(l=>/^Total Sales/.test(l.text)).text,'Total Sales / Total Received');
 for(const s of [1,3]){
  const scaled=shot.map(w=>({...w,x:w.x*s,y:w.y*s,w:w.w*s,h:w.h*s}));
  const r=locateRegions(scaled,756*s,460*s,s,w=>coin(w));
  assert.deepEqual(r.total,{x:571,y:108,w:43,h:16},'total at scale '+s);          // the top (sales) number, not Total Received
  assert.ok(r.items&&r.items.y<=32&&r.items.y+r.items.h<94&&r.items.x>=560&&!r.itemsEstimated,'items at scale '+s);
  assert.ok(r.sale.y<=32&&r.sale.y+r.sale.h>=139&&r.sale.x+r.sale.w>=740,'sale snapshot covers entry and totals at scale '+s);
  assert.deepEqual(r.balance,{x:131,y:135,w:43,h:16},'balance at scale '+s);
 }
 // No sales yet: the totals are still found and the list area is estimated until the window changes.
 const empty=locateRegions(shot.filter(w=>w.y<20||w.y>=94),756,460,1,coin);
 assert.ok(empty.total&&empty.items&&empty.itemsEstimated);
 // Received larger than Sales cannot be a stacked total pair.
 assert.equal(locateRegions(shot.map(w=>w.text==='13,269'?{...w,text:'99,999'}:w),756,460,1,coin).total,undefined);
 // OCR slips on the labels and digits: fused "TotalSales", "Tota1 Sa1es", "13,679mesos", a low-confidence number.
 const relabel=(from,to)=>shot.flatMap(w=>w.text===from?to:[w]);
 const fused=[...shot.filter(w=>!(w.y===94&&/^(Total|Sales)$/.test(w.text)&&w.x<600)),{text:'TotalSales',x:573,y:94,w:62,h:12,confidence:80,group:'f'}];
 for(const [why,words] of [['fused label',fused],['l read as 1',shot.map(w=>w.y===94&&w.text==='Total'?{...w,text:'Tota1'}:w.y===94&&w.text==='Sales'?{...w,text:'Sa1es'}:w)],
   ['digits fused to mesos',relabel('13,679',{text:'13,679mesos',x:573,y:110,w:71.5,h:12,confidence:90,group:'m'})],
   ['low confidence',shot.map(w=>w.y>=110&&w.y<=127&&w.x>=573?{...w,confidence:45}:w)]]){
  const r=locateRegions(words,756,460,1,coin);
  assert.ok(r.total&&Math.abs(r.total.x-571)<=1&&r.total.y===108&&r.total.w<=45&&!r.totalEstimated,why+': total found');assert.ok(r.items,why+': items found');}
 // Label readable but its number not: the line under the label is used and marked as an estimate.
 const blank=locateRegions(shot.filter(w=>!(w.y>=110&&w.y<=127&&w.x>=573)),756,460,1,coin);
 assert.ok(blank.total&&blank.totalEstimated&&blank.total.y>=104&&blank.total.y<=110&&blank.items,'unreadable number: estimated total');
 console.log('Auto Select checks passed: store screenshot layout at 1x and 3x, split OCR groups, stacked totals, untitled list, balance.');
}
// Whole-shop reading on the store screenshot: title, icon boxes, and stats from a hovered item's tooltip.
{
 let g=5000;const solo=(y,x0,text,confidence=95)=>{let x=x0;return text.split(' ').map(t=>{const w={text:t,x,y,w:t.length*6.5,h:12,confidence,group:String(g++)};x+=w.w+4;return w;});};
 const base=[...solo(18,20,'Cheap Halloween NX'),...solo(62,150,'SOLD ITEMS'),...solo(92,148,'OPEN STORE'),...solo(138,40,'Internaly'),...solo(137,133,'50,615'),
  ...solo(157,46,'Grey Skull Overall'),...solo(174,46,'1 for 24,679 mesos'),...solo(197,46,'Tiger Mask'),...solo(214,46,'1 for 23,679 mesos'),
  ...solo(8,300,'<Free Market> Free Market Entrance')];
 const tooltip=[...solo(205,240,'Tiger Mask'),...solo(225,240,'Req LEV : 30'),...solo(240,240,'STR : +3'),...solo(255,240,'Weapon Def. : 45'),...solo(270,240,'Number of upgrades available : 7')];
 const shop=readShop([...base,...tooltip]);
 assert.equal(shop.shopTitle,'Cheap Halloween NX');
 assert.equal(shop.map,'Free Market Entrance');
 assert.deepEqual(shop.listings.map(l=>[l.item,l.price]),[['Grey Skull Overall',24679],['Tiger Mask',23679]]);
 assert.deepEqual(shop.listings[1].stats,{str:3,slots:7});      // "Weapon Def." misses the pattern on purpose: no guessing
 assert.deepEqual(shop.listings[0].stats,{});
 assert.ok(shop.listings[0].icon.x<46&&shop.listings[0].icon.x>=0&&shop.listings[0].icon.w>=30);
 assert.equal(readShop(base).listings[1].stats.str,undefined);
 assert.equal(readShop([]).listings.length,0);
 assert.equal(averageHash(Array.from({length:64},(_,i)=>i<32?0:255)),'00000000ffffffff');
 assert.equal(shopKeyOf('', 'Cheap Halloween NX','FM 1'),'|fm 1|cheap halloween nx');assert.equal(shopKeyOf('','',''),'');
 console.log('Shop reading checks passed: title, buttons ignored, tooltip stats on the hovered listing, icon boxes, hashes.');
}
// Real Tesseract output (tesseract.js 6.0.1, psm 11) from the user's 756x460 store screenshot at the site's 3x frame scale,
// with real gold-coin pixel scores. This is what the browser sees; synthetic layouts above cannot reproduce its noise.
{
 const words=tsvWords(fs.readFileSync(new URL('./tests/fixtures/store-3x.tsv',import.meta.url),'utf8'));
 const coins=JSON.parse(fs.readFileSync(new URL('./tests/fixtures/store-3x-coins.json',import.meta.url),'utf8'));
 const r=locateRegions(words,2268,1380,3,w=>coins[w.x+','+w.y]||0);
 assert.deepEqual(r.total,{x:573,y:106,w:40,h:15});                       // "13,679" (Total Sales), not 13,269 (Received)
 assert.ok(r.items.x<=573&&r.items.y<=32&&r.items.y+r.items.h>=80&&r.items.y+r.items.h<94);  // the scroll entry
 assert.ok(r.balance&&r.balance.x>=175&&r.balance.x<=185&&r.balance.y<=131&&r.balance.y+r.balance.h>=145);  // "50,615"
 const shop=readShop(words);
 assert.deepEqual(shop.listings.map(l=>[l.item,l.price]),[['Grey Skull Overall',24679],['Tiger Mask',23679],['Ghost Costume',20679],['Pumpkin Hat',20679],['Ghost Suit',19679],['Black Leather Boots',21679]]);
 assert.ok(shop.listings.every(l=>!l.certain&&l.qty===null));            // "1 for" unreadable at frame scale: must be re-read
 assert.equal(readShopListings(words).length,0);                         // nothing unconfirmed is ever reported directly
 // Targeted 4x re-reads of those price lines (real output, both passes) and what must be rejected.
 assert.deepEqual(parsePriceLine('1 for 24,679 mesos'),{qty:1,price:24679,bundle:24679});
 assert.deepEqual(parsePriceLine('1 for 21,679 mesos fi'),{qty:1,price:21679,bundle:21679});
 assert.deepEqual(parsePriceLine('100 for 50,000 mesos'),{qty:100,price:500,bundle:50000});
 assert.equal(parsePriceLine('ar 23,679 mesos'),null);assert.equal(parsePriceLine(''),null);
 console.log('Real-screenshot checks passed: Auto Select finds total, items and balance; all 6 shop listings found and held for re-reading.');
}
// Megaphone rules: the website copy must be byte-identical to the one the checkout function enforces.
{
 const site=fs.readFileSync(new URL('./dist/megaphone-rules.mjs',import.meta.url),'utf8'),server=fs.readFileSync(new URL('./supabase/functions/_shared/megaphone-rules.js',import.meta.url),'utf8');
 assert.equal(site,server,'dist/megaphone-rules.mjs differs from supabase/functions/_shared/megaphone-rules.js');
 const {checkMegaphone}=await import('./dist/megaphone-rules.mjs');
 assert.deepEqual(checkMegaphone({message:'WTS Steelies 1.2m ch 3 FM 7',sender:'Internaly'}).errors,[]);
 for(const bad of ['hi','join discord.gg/abc','visit www.example.com','selling mesos for $5 paypal','BUY MY STUFF NOW CHEAP CHEAP','looooooool','x'.repeat(121)])assert.ok(checkMegaphone({message:bad}).errors.length,bad);
 assert.equal(checkMegaphone({message:'  WTS\u200b  Steelies \u202e ch3 '}).message,'WTS Steelies ch3');
 console.log('Megaphone rule checks passed: same rules on site and server, links, real-money trading, caps, spam and hidden characters refused.');
}
// Chart markup and catalog import mapping.
{
 const {chartSvg,shortMesos}=await import('./dist/chart.mjs');
 const now=Date.parse('2026-11-01T12:00:00Z');
 const svg=chartSvg([{bucket:'2026-10-31T00:00:00Z',kind:'ask',low:20000,median:24679,high:30000,n:3},{bucket:'2026-11-01T00:00:00Z',kind:'ask',low:19679,median:21679,high:24679,n:5},{bucket:'2026-11-01T00:00:00Z',kind:'sale',low:23000,median:23000,high:23000,n:1}],{range:'7d',now});
 assert.ok(svg.includes('class="ask"')&&svg.includes('class="sale-pt"')&&svg.includes('class="band"'));
 assert.ok(!/NaN|undefined/.test(svg));
 assert.ok(chartSvg([],{now}).includes('No prices recorded'));
 assert.ok(!chartSvg([{bucket:'2026-11-01T00:00:00Z',kind:'ask',low:1,median:1,high:1,n:1}],{now}).includes('<script'));
 assert.deepEqual([shortMesos(950),shortMesos(24679),shortMesos(1250000),shortMesos(2e9)],['950','24,679','1,250,000','2,000,000,000']);
 const {toRows,toSql}=await import('./supabase/import-catalog.mjs');
 const rows=toRows([{id:1051022,name:'Grey  Skull Overall',category:'Equipment'},{id:1050012,name:'Grey Skull Overall',category:'Equipment',sub_category:'Overall',req_classes:['Warrior'],stats:{reqLevel:30,incPDD:20,incSTR:0},description:'A #cgrey#k overall.\nWarm.'},{id:4031000,name:'Quest Letter',category:'Etc',stats:{quest:1}},{id:1002000,name:'Bound Hat',category:'Equipment',stats:{tradeBlock:1}},{id:2000000,name:"Red Potion",category:'Consumable',spec:{hp:100}},{id:1,name:'X'}]);
 assert.deepEqual(rows.map(r=>[r.game_id,r.category]),[[1050012,'equip'],[2000000,'use']]);
 assert.deepEqual(rows[0].base_stats,{reqLevel:30,jobs:['Warrior'],stats:{incPDD:20},desc:'A grey overall. Warm.'});
 assert.ok(toSql([{...rows[1],name:"Rock's Potion"}]).includes("'Rock''s Potion'"));
 globalThis.window??={};const {baseStats}=await import('./dist/api.mjs');
 assert.deepEqual(baseStats(rows[0]).stats,[['Weapon DEF',20]]);
 assert.deepEqual(baseStats(rows[1]).stats,[['Restores HP',100]]);
 console.log('Chart and catalog checks passed: series drawn, empty state, no NaN, mesos shorthand, catalog dedupe keeps the lowest id and drops untradeable items.');
}
