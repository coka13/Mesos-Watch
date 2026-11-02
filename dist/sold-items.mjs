// My Store evidence for the Sold Items layout (no cumulative Sales total).
// A sale is verified only when independent evidence agrees: a new Sold Items record (name, buyer, quantity) read the same
// way by two OCR passes, a personal-balance increase that equals a sale after the store fee, and either the listed price
// the player entered or the buyer being seen in the shop chat. Anything else is kept as an uncertain event.

// The in-game store notice: "Please be aware that a 3% fee will be deducted from sales."
export const STORE_FEE_RATE=0.03;

// OCR swaps these in the game font. Folding lets two readings of the same word compare equal.
export const fold=t=>String(t||'').toLowerCase().replace(/[‘’'`"]/g,'').replace(/0/g,'o').replace(/[1|!]/g,'l').replace(/5/g,'s').replace(/\s+/g,' ').trim();
const nameKey=t=>fold(t).replace(/(?:\.{2,}|…)\s*$/,'').replace(/[^a-z0-9 ]/g,'').trim();
const BUYER=/^bu[yv]er\s*[:;.,]?\s*(\S.*)$/i;
const PURCHASED=/purchased\s*[:;.,]?\s*(\d{1,4})\b/i;

// Records in reading order. A record needs a name line, a Buyer line and a Number purchased line, in that order.
export function parseSoldRecords(text){
 const records=[];let current=null;
 for(const raw of String(text||'').split('\n')){
  const line=raw.trim().replace(/\s+/g,' ');if(!line)continue;
  const buyer=line.match(BUYER),qty=line.match(PURCHASED);
  if(buyer){if(current&&current.name&&!current.buyer)current.buyer=buyer[1].replace(/[^\p{L}\p{N}_-]+$/u,'');else current=null;continue;}
  if(qty){if(current?.name&&current.buyer){const n=Number(qty[1]);if(n>0)records.push({name:current.name,buyer:current.buyer,qty:n,truncated:/(?:\.{2,}|…)\s*$/.test(current.name)});}current=null;continue;}
  if(/sold\s*items?|total\s*(?:sales|received)/i.test(line))continue;
  if(/[a-zA-Z]{3}/.test(line))current={name:line.replace(/^[^a-zA-Z0-9]+/,'').replace(/(?:\.{2,}|…).*$/,'...')};
 }
 return records.map(r=>({...r,key:nameKey(r.name)+'|'+fold(r.buyer)+'|'+r.qty}));
}

// Two preprocessings of the same crop. A record is trusted only when both passes produced it; the rest stay visible but
// cannot verify a sale. Records are compared as multisets so one misread line cannot shift every later record.
export function chooseSoldReading(first,second){
 const a=parseSoldRecords(first.text),b=parseSoldRecords(second.text);
 const left=new Map();for(const r of b)left.set(r.key,(left.get(r.key)||0)+1);
 const records=a.map(r=>{const n=left.get(r.key)||0;if(n)left.set(r.key,n-1);return{...r,agreed:n>0};});
 const confidence=Math.min(first.confidence??0,second.confidence??0);
 return{records,confidence,complete:a.length===b.length&&records.every(r=>r.agreed),display:records.map(r=>`${r.name} ×${r.qty} → ${r.buyer}`).join('\n')};
}

// Buyers seen entering the shop, from shop-chat text ("Ssr1 has entered.").
export function chatVisitors(text){
 const names=[];for(const line of String(text||'').split('\n')){const m=line.trim().match(/^\[?([\p{L}\p{N}_-]{2,24})\s+ha[sg]\s+(?:entered|[l\[]eft)\b/iu);if(m)names.push(m[1]);}
 return names;
}
function distance(a,b){const d=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=t;}}return d[b.length];}
// Character names in both crops are OCR'd, so allow about one error per four characters.
export function sameName(a,b){const x=fold(a).replace(/[^a-z0-9]/g,''),y=fold(b).replace(/[^a-z0-9]/g,'');if(x.length<2||y.length<2)return false;return distance(x,y)<=Math.max(1,Math.floor(Math.min(x.length,y.length)/4));}

// Listed prices the player typed: "Ghost Suit = 20,679" or "Ghost Suit 20679", one per line.
export function parsePriceList(text){
 const prices=new Map();
 for(const line of String(text||'').split('\n')){const m=line.trim().match(/^(.+?)\s*[=:,\t]?\s*(\d{1,3}(?:[,.\s]\d{3})+|\d{1,12})\s*(?:mesos?)?$/i);if(!m)continue;const price=Number(m[2].replace(/[,.\s]/g,''));if(Number.isSafeInteger(price)&&price>0&&nameKey(m[1]))prices.set(nameKey(m[1]),price);}
 return prices;
}
// Exact name, or a unique prefix when the Sold Items list cut the name off with "...".
export function listedPrice(prices,record){
 const key=nameKey(record.name);if(prices.has(key))return prices.get(key);
 if(!record.truncated||key.length<4)return null;
 const hits=[...prices.entries()].filter(([name])=>name.startsWith(key));
 return hits.length===1?hits[0][1]:null;
}

// The game's fee rounding is not documented, so accept floor, round or ceil of the fee.
export function netOf(gross,rate=STORE_FEE_RATE){return[...new Set([Math.floor,Math.round,Math.ceil].map(f=>gross-f(gross*rate)))];}
export const netMatches=(gross,net,rate=STORE_FEE_RATE)=>netOf(gross,rate).includes(net);
// Unit prices whose fee-adjusted total equals the balance increase. Usually one; occasionally two adjacent values.
export function unitPricesFor(net,qty,rate=STORE_FEE_RATE){
 if(!(net>0)||!(qty>0))return[];
 const estimate=net/(qty*(1-rate)),out=[];
 for(let p=Math.max(1,Math.floor(estimate)-3);p<=Math.ceil(estimate)+3;p++)if(netMatches(p*qty,net,rate))out.push(p);
 return out;
}

// Decide what a confirmed change means. Never treats a balance change on its own as a sale.
export function verifySales(records,balanceIncrease,{prices=new Map(),visitors=[],feeRate=STORE_FEE_RATE}={}){
 const uncertain=reason=>({verified:false,reason,records,balanceIncrease});
 if(!records.length)return uncertain('No new Sold Items record.');
 if(records.some(r=>!r.agreed))return uncertain('A new Sold Items record was read differently by the two OCR passes.');
 if(!(balanceIncrease>0))return uncertain(balanceIncrease<0?'Your mesos went down while an item sold (another transaction happened at the same time).':'An item appeared in Sold Items but your mesos did not increase. It may have scrolled into view.');
 const known=records.map(r=>listedPrice(prices,r));
 if(known.every(p=>p!==null)){
  const grosses=records.map((r,i)=>known[i]*r.qty);
  const nets=records.map((r,i)=>netOf(grosses[i],feeRate));
  // Each sale's fee is rounded separately; accept any combination.
  let totals=new Set([0]);for(const options of nets){const next=new Set();for(const t of totals)for(const n of options)next.add(t+n);totals=next;}
  if(totals.has(balanceIncrease))return{verified:true,method:'listed-price',reason:'New Sold Items record, your listed price and the mesos increase after the '+(feeRate*100)+'% fee agree.',
   sales:records.map((r,i)=>({name:r.name,buyer:r.buyer,qty:r.qty,unitPrice:known[i],gross:grosses[i],net:records.length===1?balanceIncrease:nets[i][0],fee:records.length===1?grosses[i]-balanceIncrease:grosses[i]-nets[i][0],buyerSeen:visitors.some(v=>sameName(v,r.buyer))}))};
  return uncertain('The mesos increase does not match your listed price'+(records.length>1?'s':'')+' after the fee.');
 }
 if(records.length>1)return uncertain('Several items sold at once and not all of them have a listed price, so the mesos cannot be split between them.');
 const [r]=records,units=unitPricesFor(balanceIncrease,r.qty,feeRate);
 if(!units.length)return uncertain('The mesos increase is not a whole-meso price after the '+(feeRate*100)+'% fee.');
 if(!visitors.some(v=>sameName(v,r.buyer)))return uncertain('No listed price for this item, and the buyer was not seen in the shop chat. Add your price under "Your listed prices" to verify it.');
 const unitPrice=units[Math.floor(units.length/2)];
 return{verified:true,method:'balance-and-chat',reason:'New Sold Items record, the buyer seen in your shop chat, and a mesos increase that is a whole price after the fee.',
  sales:[{name:r.name,buyer:r.buyer,qty:r.qty,unitPrice,unitPriceRange:units.length>1?[units[0],units.at(-1)]:null,gross:unitPrice*r.qty,net:balanceIncrease,fee:unitPrice*r.qty-balanceIncrease,buyerSeen:true}]};
}

const counts=records=>{const m={};for(const r of records)m[r.key]=(m[r.key]||0)+1;return m;};
const valid=n=>Number.isSafeInteger(n)&&n>=0;
// Readings to wait for the other half of the evidence (the balance box and the list do not always update together).
export const EVIDENCE_WAIT=3;

// One step of the Sold Items session. state is frozen; the session's starting balance is never replaced.
// reading: {balance, records (from chooseSoldReading), confidence, visitors, prices, feeRate}
export function observeSoldItems(state,reading){
 const keep=(kind,extra={})=>({kind,...extra,state:Object.freeze({...state,...(extra.patch||{})})});
 if(!valid(reading.balance))return keep('unreadable',{reason:'Personal mesos unreadable.'});
 if(!Array.isArray(reading.records)||(reading.confidence??0)<50)return keep('unreadable',{reason:'Sold Items unreadable.'});
 const now=counts(reading.records.filter(r=>r.agreed));
 const visitors=[...new Set([...(state.visitors||[]),...(reading.visitors||[])])].slice(-200);
 if(state.mode!=='sold-items'||!state.seen){
  return{kind:'baseline',state:Object.freeze({...state,mode:'sold-items',initialBalance:state.initialBalance??reading.balance,balanceRef:reading.balance,seen:Object.freeze(now),glimpsed:Object.freeze(reading.records.filter(r=>!r.agreed).map(r=>r.key)),visitors,candidate:null,waits:0})};
 }
 const fresh=[];for(const r of reading.records.filter(r=>r.agreed)){const before=state.seen[r.key]||0,taken=fresh.filter(f=>f.key===r.key).length;if((now[r.key]||0)-before>taken)fresh.push(r);}
 // Records only one pass produced: never a sale on their own, but they block a verification that might be missing them.
 const unsure=reading.records.filter(r=>!r.agreed&&!(r.key in state.seen)&&!(state.glimpsed||[]).includes(r.key));
 const glimpsed=Object.freeze([...new Set([...(state.glimpsed||[]),...reading.records.filter(r=>!r.agreed).map(r=>r.key)])].slice(-200));
 const delta=reading.balance-state.balanceRef;
 const seen=Object.freeze({...state.seen,...Object.fromEntries(Object.entries(now).map(([k,n])=>[k,Math.max(n,state.seen[k]||0)]))});
 if(!fresh.length&&delta===0)return{kind:'unchanged',state:Object.freeze({...state,visitors,candidate:null,waits:0})};
 const signature=JSON.stringify([fresh.map(r=>r.key).sort(),unsure.map(r=>r.key).sort(),reading.balance]);
 if(state.candidate!==signature)return{kind:'pending',state:Object.freeze({...state,visitors,candidate:signature,waits:0})};
 // Confirmed twice. If one half of the evidence is missing, give the other a few readings to catch up.
 const waits=(state.waits||0)+1;
 if((!fresh.length||delta===0)&&waits<EVIDENCE_WAIT)return{kind:'pending',waiting:fresh.length?'balance':'record',state:Object.freeze({...state,visitors,candidate:signature,waits})};
 const next=Object.freeze({...state,visitors,seen,glimpsed,balanceRef:reading.balance,candidate:null,waits:0});
 if(!fresh.length)return{kind:'balance-change',balanceChange:delta,reason:'Your mesos changed with no new Sold Items record (another transaction, not a sale).',state:next};
 const records=unsure.length?[...fresh,...unsure]:fresh;
 const result=verifySales(records,delta,{prices:reading.prices,visitors,feeRate:reading.feeRate??STORE_FEE_RATE});
 return{kind:result.verified?'sale':'uncertain',...result,balanceChange:delta,state:next};
}

// Two passes of a numeric crop. The balance box border lowers Tesseract's confidence even on clean digits, so two agreeing
// readings in the game's digit-group format are accepted at a lower confidence than a lone reading would be.
export function agreedNumber(a,b,parse){
 const first=parse(String(a.text||'').trim()),second=parse(String(b.text||'').trim());
 if(first===null||first!==second)return null;
 const confidence=Math.min(a.confidence??0,b.confidence??0);
 const grouped=/^\d{1,3}(?:[,.]\d{3})+$/.test(String(a.text).trim())&&/^\d{1,3}(?:[,.]\d{3})+$/.test(String(b.text).trim());
 return confidence>=65||(grouped&&confidence>=50)?first:null;
}
