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

// Classic store windows in unscaled (1:1 UI) pixels, measured on the reference screenshot. Sold Items is relative to the first
// visible "Number purchased" line; the chat and balance fallbacks to the Close Store label. `text` is the part OCR reads.
const SOLD_WINDOW={x:-45,y:-62,w:226,h:266,text:{x:41,y:24,w:156,h:226}};
const CHAT_WINDOW={x:84,y:39,w:262,h:222,text:{x:2,y:2,w:258,h:212}};
const BALANCE_FIELD={x:-25,y:12,w:96,h:26};
// Distance between consecutive Sold Items entries, and offsets of an entry's name and buyer lines above its quantity line.
// The observed spacing gives the UI scale (display scaling, resized capture).
const ENTRY_PITCH=58,ENTRY_LINES=[35,18],QUANTITY_TEXT_H=11;
const QUANTITY=/^[nhm][a-z]{3,6}[\s.,:;]*p[a-z]{1,3}[cr]/i;
const CHAT_MESSAGE=l=>/\b[hn]a[sgz]\b/i.test(l.text)&&/ent|nt[ae]r|r[oa]{1,2}m|\ble[ft]|\blef|efi|lett|lgn/i.test(l.text);

// White areas in the scaled frame's RGBA pixels. Text never touches an area's margins, so a row belongs to the area when both
// margins are white; thin separator lines (up to 3 source pixels) are crossed.
const isWhite=({data,width},x,y)=>{const p=(Math.round(y)*width+Math.round(x))*4;return data[p]>248&&data[p+1]>248&&data[p+2]>248;};  // window frames are near-white (~245)
function whiteShare(px,x0,y0,x1,y1){let n=0,t=0;const sx=x1>x0?2:1,sy=y1>y0?2:1;for(let y=y0;y<=y1;y+=sy)for(let x=x0;x<=x1;x+=sx){t++;if(isWhite(px,x,y))n++;}return t?n/t:0;}
function extend(start,step,limit,inside,gap){let edge=start,miss=0;for(let v=start;step>0?v<=limit:v>=limit;v+=step){if(inside(v)){edge=v;miss=0;}else if(++miss>gap)break;}return edge;}
// The shop chat: the white message area found from the left-aligned "has entered / has left" lines, plus the input line below it.
function findChat(px,lines,s,ui,limitX){
 const msgs=lines.filter(l=>CHAT_MESSAGE(l)&&l.x+l.w<limitX);if(msgs.length<3)return null;
 const xs=msgs.map(l=>l.x).sort((a,b)=>a-b),mx=xs[Math.floor(xs.length/2)],col=msgs.filter(l=>Math.abs(l.x-mx)<4*ui);if(col.length<3)return null;
 const top=Math.min(...col.map(l=>l.y)),bottom=Math.max(...col.map(l=>l.y+l.h)),right=Math.max(...col.map(l=>l.x+l.w));
 const W=px.width-1,H=px.height-1,column=x=>whiteShare(px,x,top,x,bottom)>=.6;
 const L=extend(Math.floor(mx-2*ui),-1,0,column,0),R=extend(Math.ceil(right+1),1,W,column,0);
 if(R-L<100*ui||L>mx-ui)return null;
 const m=Math.max(1,Math.round(2*ui)),row=y=>whiteShare(px,L,y,L+m,y)>=.8&&whiteShare(px,R-m,y,R,y)>=.8,gap=3*s;
 const T=extend(Math.floor(top),-1,0,row,gap),B=extend(Math.ceil(bottom),1,H,row,gap);
 // The input line: past the frame under the messages (blurred captures leave a near-white row first), rows white along the left
 // part for at least 6 UI pixels.
 const input=y=>whiteShare(px,L+m,y,L+(R-L)*.6,y)>=.9;let y=B+1,IB=B;
 while(y<=H&&y<B+24*ui){while(y<=H&&!input(y))y++;const end=extend(y,1,H,input,0);if(y<B+24*ui&&end-y+1>=6*ui){IB=end;break;}y=end+1;}
 return{x:L,y:T,w:R-L+1,h:B-T+1,bottom:IB};
}
// The personal mesos field: a white box just above and left of the chat; its left part is empty (digits are right-aligned).
function findField(px,chat,ui){
 const cx=chat.x-80*ui,cy=chat.y-16*ui;if(cx<0||cy<0||!isWhite(px,cx,cy))return null;
 const col=y=>isWhite(px,cx,y),T=extend(Math.floor(cy),-1,0,col,0),B=extend(Math.ceil(cy),1,px.height-1,col,0);
 const ry=T+1,row=x=>isWhite(px,x,ry),L=extend(Math.floor(cx),-1,0,row,0),R=extend(Math.ceil(cx),1,chat.x,row,0);
 const w=R-L+1,h=B-T+1;
 return w>=60*ui&&w<=130*ui&&h>=8*ui&&h<=32*ui&&R<chat.x?{x:L,y:T,w,h}:null;
}

// `pixels` (optional): RGBA of the same scaled frame the words come from; it lets the chat and balance follow the drawn windows.
export function locateRegions(words,width,height,scale=1,coinScore=()=>0,pixels=null){
 let ui=scale;
 const box=(o,a)=>({x:o.x+a.x*ui,y:o.y+a.y*ui,w:a.w*ui,h:a.h*ui}),inset=box;
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
 // Some Classic shop layouts have a scrolling Sold Items panel with no cumulative Sales total.
 // Locate repeated Buyer / Number purchased records independently; never substitute the personal balance for Sales.
 if(!totalLabel&&!result.items){
  // Anchored on "Number purchased" lines, which OCR reads far more reliably than buyer names in this small font.
  const groups=[];for(const q of lines.filter(l=>QUANTITY.test(l.text)).sort((a,b)=>a.y-b.y)){const g=groups.find(g=>Math.abs(g[0].x-q.x)<q.h*1.5);if(g)g.push(q);else groups.push([q]);}
  const candidates=groups.filter(g=>g.length>=2);
  if(candidates.length===1){const qs=candidates[0],gaps=qs.slice(1).map((q,i)=>q.y-qs[i].y).sort((a,b)=>a-b),hs=qs.map(q=>q.h).sort((a,b)=>a-b);
   let pitch=gaps[Math.floor((gaps.length-1)/2)];
   // A missing entry doubles a gap; the text height tells one entry from two.
   const k=Math.max(1,Math.round(pitch/ENTRY_PITCH/(hs[Math.floor(hs.length/2)]/QUANTITY_TEXT_H)));pitch/=k;
   const u=pitch/ENTRY_PITCH;
   if(u>=.6*scale&&u<=4*scale&&gaps.every(g=>Math.abs(g/pitch-Math.round(g/pitch))<.15)){
    // Rows are whole entries apart; snap near-1:1 readings so OCR jitter does not move the boxes.
    ui=Math.abs(u/scale-1)<.04?scale:u;
    const qx=Math.min(...qs.map(q=>q.x));let first=qs[0].y;
    // The first entry's own quantity line may be unread: its name or buyer line above still marks the top entry.
    if(lines.some(l=>Math.abs(l.x-qx)<4*ui&&ENTRY_LINES.some(o=>Math.abs(first-l.y-pitch-o*ui)<5*ui)))first-=pitch;
    const panel=box({x:qx,y:first},SOLD_WINDOW);
    result.items={...rect(panel),text:rect(inset(panel,SOLD_WINDOW.text))};
    result.sale=rect(panel);result.mode='sold-items';shop=panel;
   }
  }
 }
 const inventory=lines.find(l=>/\binventory\b/i.test(l.text));
 const followedByMesos=w=>words.some(o=>/^m[e3]s[o0]s?$/i.test(o.text)&&o.x>w.x+w.w&&o.x-(w.x+w.w)<w.h*1.5&&Math.abs(o.y-w.y)<w.h*.6);
 // The balance box's border often drags OCR confidence to 0 ("50,615)"), so a strong gold-coin match may stand in for confidence;
 // the balance itself is then read from the crop twice with a digit-only pass before it is shown.
 const digits=w=>parseTotal(w.text.replace(/^[^\d]+|[^\d]+$/g,''));
 const inInventory=w=>!!inventory&&w.y>inventory.y&&w.y<inventory.y+450*scale&&Math.abs(w.x-inventory.x)<230*scale;
 const inventoryMesos=w=>inInventory(w)&&words.some(label=>/^mesos?[:;]?$/i.test(label.text)&&label.x+label.w<=w.x&&w.x-label.x-label.w<150*scale&&Math.abs(label.y-w.y)<Math.max(label.h,w.h)*.6);
 // "CLOSE STORE" is often misread when scaled ("ELOSESTORE", "CELOSE.STORE", "wELOSE. STORES", "CLOSELSTORE"); the box starts at the matched C.
 const close=(()=>{for(const l of lines){const t=fold(l.text),m=t.match(/c?[ce]lose?[^a-z]{0,2}l?[^a-z]{0,2}store/);
  if(m&&t.replace(/[^a-z]/g,'').length<=m[0].replace(/[^a-z]/g,'').length+3){const per=l.w/t.length;return{...l,x:l.x+m.index*per,w:m[0].length*per};}}return null;})();
 const controls=close&&(result.mode==='sold-items'||lines.some(l=>['openstore','solditems'].includes(fold(l.text).replace(/[^a-z]/g,''))&&l.y<close.y&&close.y-l.y<100*scale&&Math.abs(l.x-close.x)<70*scale));
 const controlMoney=controls?words.map(amount).filter(w=>w&&w.confidence>=50&&w.x>=close.x-50*ui&&w.x+w.w<=close.x+120*ui&&w.y>=close.y+close.h*.6&&w.y<close.y+close.h+28*ui):[];
 const money=words.filter(w=>digits(w)!==null&&w.w>=w.h*.8&&(!followedByMesos(w)||inInventory(w))&&(!shop||w.x<shop.x||w.x>shop.x+shop.w||w.y<shop.y||w.y>shop.y+shop.h)).filter(w=>!inventory||(w.y>inventory.y&&w.y<inventory.y+450*scale&&Math.abs(w.x-inventory.x)<230*scale)).map(w=>({word:w,score:inventoryMesos(w)?1:coinScore(w)})).filter(c=>c.score>=.025).sort((a,b)=>b.score-a.score);
 // Never choose between multiple money-looking fields without a clear winner.
 if(money.length===1||(money.length>1&&money[0].score>=money[1].score*2.5)){const w=money[0].word;result.balance=rect({x:w.x-2*scale,y:w.y-2*scale,w:w.w+4*scale,h:w.h+4*scale});}
 // The balance field and the shop chat sit at fixed offsets from the Close Store button in the same window.
 const field=controls&&box(close,BALANCE_FIELD);
 const inField=w=>w.x+w.w/2>=field.x&&w.y+w.h/2>=field.y&&w.x+w.w/2<=field.x+field.w&&w.y+w.h/2<=field.y+field.h;
 if(controls&&controlMoney.length===0){result.balance=rect(result.mode==='sold-items'?field:{x:close.x-25*scale,y:close.y+close.h+8*scale,w:close.w+35*scale,h:Math.max(close.h*3,22*scale)});result.balanceEstimated=true;}
 // Padding to the user's placements: the chat box starts at its window frame, the mesos box covers the field's frame.
 const pad=(r,p,top=p,bottom=p)=>({x:r.x-p,y:r.y-top,w:r.w+2*p,h:r.h+top+bottom});
 // From the frame's pixels when available: the chat's white message area and input line, then the mesos field beside it.
 const area=pixels&&result.mode==='sold-items'?findChat(pixels,lines,scale,ui,shop.x):null;
 if(area){result.chat={...rect(pad({...area,h:area.bottom-area.y+1},2*ui,6*ui)),text:rect(area)};
  const f=findField(pixels,area,ui);if(f){result.balance=rect(pad(f,3*ui,5*ui,6*ui));delete result.balanceEstimated;}}
 else if(controls&&result.mode==='sold-items'){
  const messages=lines.filter(l=>CHAT_MESSAGE(l)&&l.x>close.x+close.w&&l.x<shop.x&&l.y>close.y+close.h);
  const chat=box(close,CHAT_WINDOW);chat.w=Math.min(chat.w,shop.x-chat.x);
  if(messages.length>=3&&messages.every(l=>l.x>=chat.x&&l.x+l.w<=chat.x+chat.w&&l.y>=chat.y&&l.y+l.h<=chat.y+chat.h))result.chat={...rect(chat),text:rect(inset(chat,CHAT_WINDOW.text))};
 }
 // The field geometry is measured only for the Sold Items layout; other layouts keep the box around the digits.
 if(controlMoney.length===1&&!(area&&result.balance&&!result.balanceEstimated)){const w=controlMoney[0];result.balance=rect(result.mode==='sold-items'&&inField(w)?field:{x:w.x-2*scale,y:w.y-2*scale,w:w.w+4*scale,h:w.h+4*scale});}
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
