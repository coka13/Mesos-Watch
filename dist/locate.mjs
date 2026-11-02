import {parseTotal} from './detection.mjs';
export function tsvWords(tsv){return String(tsv||'').split('\n').slice(1).map(row=>{const c=row.split('\t');return{level:+c[0],group:c.slice(1,5).join('-'),x:+c[6],y:+c[7],w:+c[8],h:+c[9],confidence:+c[10],text:c.slice(11).join('\t').trim()};}).filter(w=>w.level===5&&w.text&&w.w>0&&w.h>0);}
function union(words){const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));return{x,y,w:Math.max(...words.map(w=>w.x+w.w))-x,h:Math.max(...words.map(w=>w.y+w.h))-y};}

// Visual lines built from word geometry. Tesseract's own line ids split one row into several groups in sparse mode (psm 11),
// so words are joined when their vertical centres line up and the gap between them is small relative to the text height.
export function rowsOf(words){
 const sorted=[...words].sort((a,b)=>(a.y+a.h/2)-(b.y+b.h/2)||a.x-b.x),rows=[];
 // Item sprites are often read as one tall "letter" spanning a name row and the price row below it; such outliers stand alone.
 const hs=words.map(w=>w.h).sort((a,b)=>a-b),medH=hs[Math.floor(hs.length/2)]||1;
 for(const w of sorted){const cy=w.y+w.h/2;if(w.h>medH*1.8){rows.push({cy,h:w.h,words:[w],solo:true});continue;}
  const row=rows.find(r=>!r.solo&&Math.abs(r.cy-cy)<Math.min(r.h,w.h)*.6);if(row){row.words.push(w);row.cy=(row.cy*(row.words.length-1)+cy)/row.words.length;row.h=Math.max(row.h,w.h);}else rows.push({cy,h:w.h,words:[w]});}
 const lines=[];
 for(const row of rows){
  row.words.sort((a,b)=>a.x-b.x);let seg=[row.words[0]];
  const flush=()=>{const u=union(seg);lines.push({words:seg,text:seg.map(w=>w.text).join(' '),conf:Math.min(...seg.map(w=>w.confidence)),...u});};
  for(const w of row.words.slice(1)){const prev=seg[seg.length-1];if(w.x-(prev.x+prev.w)>Math.max(prev.h,w.h)*2.2){flush();seg=[w];}else seg.push(w);}
  flush();
 }
 return lines.sort((a,b)=>a.y-b.y||a.x-b.x);
}
// A label read as two words ("Total" "Sales") or fused into one ("TotalSales"). OCR often swaps l/1/i/| and o/0 in the
// game font, so words are folded before matching.
const fold=t=>t.toLowerCase().replace(/[0]/g,'o').replace(/[1|!]/g,'l');
function phrase(lines,a,b){
 for(const line of lines){const ws=line.words;
  for(let i=0;i<ws.length;i++){const one=fold(ws[i].text);
   if(new RegExp('^'+a.source+b.source+'$').test(one))return union([ws[i]]);
   if(i<ws.length-1&&new RegExp('^'+a.source+'$').test(one)&&new RegExp('^'+b.source+'$').test(fold(ws[i+1].text)))return union(ws.slice(i,i+2));}}
 return null;}
const TOTAL='tota[li][:;]?',SALES='sa[li]es?[:;]?',RECEIVED='re[cg]e[il]ved[:;]?';
// Digits inside a word such as "13,679mesos" or "13,679)": the value, and the word's box trimmed to just the digits.
function amount(w){
 const m=w.text.match(/^[^\d]{0,2}(\d[\d,. ]*\d|\d)[^\d]*$/);if(!m)return null;
 const value=parseTotal(m[1]);if(value===null)return null;
 const per=w.w/Math.max(1,w.text.length),lead=w.text.indexOf(m[1]);
 return{...w,text:m[1],x:w.x+lead*per,w:m[1].length*per,value};}

export function locateRegions(words,width,height,scale=1,coinScore=()=>0){
 if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return{};
 // OCR engines sometimes return several label words in one word box. Split them with proportional geometry.
 words=words.flatMap(w=>{const matches=[...String(w.text||'').matchAll(/\S+/g)];return matches.length<=1?[w]:matches.map(m=>({...w,text:m[0],x:w.x+w.w*m.index/w.text.length,w:w.w*m[0].length/w.text.length}));});
 words=words.filter(w=>[w.x,w.y,w.w,w.h,w.confidence].every(Number.isFinite)&&w.w>0&&w.h>0&&w.x>=0&&w.y>=0&&w.x+w.w<=width&&w.y+w.h<=height);
 const lines=rowsOf(words);
 const totalLabel=phrase(lines,{source:TOTAL},{source:SALES}),receivedLabel=phrase(lines,{source:TOTAL},{source:RECEIVED});
 const result={};let shop=null;
 const rect=r=>{const x=Math.max(0,r.x),y=Math.max(0,r.y);return{x:Math.floor(x/scale),y:Math.floor(y/scale),w:Math.max(1,Math.ceil(Math.min(r.w-(x-r.x),width-x)/scale)),h:Math.max(1,Math.ceil(Math.min(r.h-(y-r.y),height-y)/scale))};};
 if(totalLabel){
  const sameRow=receivedLabel&&Math.abs(totalLabel.y-receivedLabel.y)<totalLabel.h&&receivedLabel.x>totalLabel.x;
  const left=totalLabel.x-10*scale,limit=sameRow?receivedLabel.x:totalLabel.x+260*scale;
  const under=words.map(amount).filter(w=>w&&w.x>=left&&w.x+w.w<limit&&w.y>=totalLabel.y+totalLabel.h*.6&&w.y<totalLabel.y+65*scale);
  // Prefer confident readings; the game's small digits sometimes score low, and the total is read twice again before use.
  const inline=words.map(amount).filter(w=>w&&w.confidence>=65&&w.x>=totalLabel.x+totalLabel.w&&w.x+w.w<limit&&Math.abs((w.y+w.h/2)-(totalLabel.y+totalLabel.h/2))<Math.max(w.h,totalLabel.h)*.6);
  const sure=under.filter(w=>w.confidence>=65),nums=(inline.length?inline:sure.length?sure:under.filter(w=>w.confidence>=30)).sort((a,b)=>a.y-b.y||a.x-b.x);
  // Side by side (one number under "Total Sales") or stacked (Total Sales above Total Received, which is the sales total less the fee).
  const top=nums[0],second=nums[1];
  const stackedOk=top&&second&&second.y>top.y+top.h*.6&&second.value<=top.value;
  const closeToLabel=top&&(inline.length===1||top.y<=totalLabel.y+totalLabel.h*2.5);
  if(top&&closeToLabel&&(nums.length===1||stackedOk)&&!nums.some(n=>n!==top&&Math.abs(n.y-top.y)<top.h*.6))result.total=rect({x:top.x-2*scale,y:top.y-2*scale,w:top.w+4*scale,h:top.h+4*scale});
  // Label found but its number unreadable in the full-screen pass: use the line just under the label.
  else if(!nums.length){result.total=rect({x:totalLabel.x-2*scale,y:totalLabel.y+totalLabel.h+1*scale,w:Math.min(Math.max(totalLabel.w,90*scale),limit-totalLabel.x)+4*scale,h:totalLabel.h*1.5});result.totalEstimated=true;}
  // The sold-items list sits above the totals in the same column: each entry is a name, "Buyer: …" and "Number purchased: …".
  const column=l=>l.x>=left-4*scale&&l.x<totalLabel.x+60*scale&&l.y<totalLabel.y;
  const buyers=lines.filter(l=>column(l)&&/^(buyer|number\s*purchased)\b/i.test(l.text)).sort((a,b)=>a.y-b.y);
  const title=lines.find(l=>/sold\s*[il]tems/i.test(l.text)&&l.y<totalLabel.y&&l.x<totalLabel.x+260*scale&&l.x+l.w>left);
  const entryH=totalLabel.h*4.8;
  let listTop=null;
  if(buyers.length){const first=buyers[0];const name=lines.filter(l=>column(l)&&l.y<first.y&&first.y-l.y<first.h*2.4).sort((a,b)=>b.y-a.y)[0];listTop=(name||first).y-4*scale;}
  else if(title)listTop=title.y+title.h+5*scale;
  else listTop=Math.max(0,totalLabel.y-entryH*2);  // no sales yet: an estimate, refreshed when the window changes
  const inList=lines.filter(l=>column(l)&&l.y>=listTop&&l.y<totalLabel.y);
  const right=Math.max(totalLabel.x+totalLabel.w,receivedLabel?receivedLabel.x+receivedLabel.w:0,...inList.map(l=>l.x+l.w))+12*scale;
  const bottom=Math.max(totalLabel.y+totalLabel.h,...nums.map(n=>n.y+n.h))+8*scale;
  if(totalLabel.y-listTop>15*scale){result.items=rect({x:left+4*scale,y:listTop,w:right-left-8*scale,h:totalLabel.y-listTop-4*scale});result.itemsEstimated=!buyers.length&&!title;}
  shop={x:left,y:Math.min(listTop,title?title.y-6*scale:listTop)-4*scale,w:right-left};shop.h=bottom-shop.y;
  result.sale=rect(shop);
 }
 const inventory=lines.find(l=>/\binventory\b/i.test(l.text));
 const followedByMesos=w=>words.some(o=>/^m[e3]s[o0]s?$/i.test(o.text)&&o.x>w.x+w.w&&o.x-(w.x+w.w)<w.h*1.5&&Math.abs(o.y-w.y)<w.h*.6);
 // The balance box's border often drags OCR confidence to 0 ("50,615)"), so a strong gold-coin match may stand in for confidence;
 // the balance itself is then read from the crop twice with a digit-only pass before it is shown.
 const digits=w=>parseTotal(w.text.replace(/^[^\d]+|[^\d]+$/g,''));
 const inInventory=w=>!!inventory&&w.y>inventory.y&&w.y<inventory.y+450*scale&&Math.abs(w.x-inventory.x)<230*scale;
 const inventoryMesos=w=>inInventory(w)&&words.some(label=>/^mesos?[:;]?$/i.test(label.text)&&label.x+label.w<=w.x&&w.x-label.x-label.w<150*scale&&Math.abs(label.y-w.y)<Math.max(label.h,w.h)*.6);
 const money=words.filter(w=>digits(w)!==null&&w.w>=w.h*.8&&(!followedByMesos(w)||inInventory(w))&&(!shop||w.x<shop.x||w.x>shop.x+shop.w||w.y<shop.y||w.y>shop.y+shop.h)).filter(w=>!inventory||(w.y>inventory.y&&w.y<inventory.y+450*scale&&Math.abs(w.x-inventory.x)<230*scale)).map(w=>({word:w,score:inventoryMesos(w)?1:coinScore(w)})).filter(c=>c.score>=.025).sort((a,b)=>b.score-a.score);
 // Never choose between multiple money-looking fields without a clear winner.
 if(money.length===1||(money.length>1&&money[0].score>=money[1].score*2.5)){const w=money[0].word;result.balance=rect({x:w.x-2*scale,y:w.y-2*scale,w:w.w+4*scale,h:w.h+4*scale});}
 return result;
}

// Share of gold-coin pixels to the left of a number, from RGBA pixels of the scaled frame. The balance box right-aligns its
// digits, so the coin can sit ~55px (unscaled) left of them.
export function coinScorer({data,width,height},scale=1){
 return word=>{const left=Math.max(0,Math.floor(word.x-70*scale)),right=Math.max(0,Math.floor(word.x-2*scale)),top=Math.max(0,Math.floor(word.y-4*scale)),bottom=Math.min(height,Math.ceil(word.y+word.h+4*scale));
  let gold=0,total=0;for(let y=top;y<bottom;y+=2)for(let x=left;x<right;x+=2){const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2];if(r>165&&g>100&&g<r*.96&&b<135&&r-b>60)gold++;total++;}
  return total?gold/total:0;};
}

// OCR scale for a full frame: the game's ~11px text needs at least 2x, capped so huge captures stay fast.
export const frameScale=width=>Math.min(3,Math.max(2,3840/Math.max(1,width)));
