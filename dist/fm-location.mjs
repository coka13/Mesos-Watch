// Free Market location and the owner's store list, read from the shared game window (screen reading only).
//  - FM room: the expanded minimap in the top-left corner shows "Free Market <8>".
//  - World and channel: the Change Channel menu; the current channel is the one blue cell in a grid of grey cells.
//  - Store list: the rows left of the shop chat, "Orange Potion / 1 for 125 mesos"; sold rows are greyed out.
// Pure functions over OCR words (tsvWords) and RGBA pixels {data,width,height}, shared by app.js and the tests.
import {rowsOf} from './locate.mjs?v=autoselect-9';
import {cleanMapName,looksLikeFm} from './location.mjs?v=loc-1';

const lum=(px,x,y)=>{const p=(y*px.width+x)*4,d=px.data;return .299*d[p]+.587*d[p+1]+.114*d[p+2];};
const clampRect=(r,W,H)=>{const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y));return{x,y,w:Math.max(1,Math.min(W,Math.ceil(r.x+r.w))-x),h:Math.max(1,Math.min(H,Math.ceil(r.y+r.h))-y)};};

// OCR'd words from a crop prepared by ocrImage(scale, margin) back in source pixels.
export const toSource=(words,crop,scale,margin=20)=>words.map(w=>({...w,x:crop.x+(w.x-margin)/scale,y:crop.y+(w.y-margin)/scale,w:w.w/scale,h:w.h/scale}));

// ---- FM room ----
// The corner the player is asked to keep the expanded minimap in.
export const roomCorner=(W,H)=>clampRect({x:0,y:0,w:Math.max(300,W*.4),h:Math.max(140,H*.35)},W,H);
// The minimap's title panel is light steel blue with white "Hidden Street" / "Free Market <8>" text, found from pixels so any
// capture size works (OCR over the whole corner misses the title once display scaling or a full-screen share changes its size).
const panelBlue=(px,x,y)=>{const p=(y*px.width+x)*4,[r,g,b]=[px.data[p],px.data[p+1],px.data[p+2]];return b>=170&&b-r>=30&&g-r>=15&&r>=100&&r<=200;};
const titleWhite=(px,x,y)=>{const p=(y*px.width+x)*4,d=px.data;return Math.min(d[p],d[p+1],d[p+2])>=205;};
const view=(px,r)=>{const data=new Uint8ClampedArray(r.w*r.h*4);for(let y=0;y<r.h;y++)data.set(px.data.subarray(((r.y+y)*px.width+r.x)*4,((r.y+y)*px.width+r.x+r.w)*4),y*r.w*4);return{data,width:r.w,height:r.h};};
// The "Free Market <8>" line. The blue region can join the minimap window's frame, so the panel is its tallest run of mostly
// blue rows (right of the map icon), and the line is the lowest band of white text rows in that run. Returns the crop (source
// pixels) and the text height, or null.
export function roomLine(px,corner){
 const c=view(px,corner);
 // The expanded minimap is anchored at the top-left. A larger blue sky patch can
 // share the title panel's colors, so area is not evidence of the minimap.
 const blue=components(c,panelBlue).filter(k=>k.w>=50&&k.h>=18&&k.n>=k.w*k.h*.2).sort((a,b)=>a.y-b.y||a.x-b.x)[0];
 if(!blue)return null;
 const x0=blue.x+Math.round(blue.w*.3),x1=blue.x+blue.w,rows=[];
 for(let y=blue.y;y<blue.y+blue.h;y++){let w=0,b=0;for(let x=x0;x<x1;x++){if(titleWhite(c,x,y))w++;else if(panelBlue(c,x,y))b++;}rows.push({y,w,b:b>=(x1-x0)*.3});}
 const runs=(test)=>{const out=[];for(const r of rows){if(!test(r))continue;const l=out.at(-1);if(l&&l.y1===r.y-1)l.y1=r.y;else out.push({y0:r.y,y1:r.y});}return out;};
 const panel=runs(r=>r.b).sort((p,q)=>(q.y1-q.y0)-(p.y1-p.y0))[0];
 if(!panel||panel.y1-panel.y0<15)return null;
 const band=runs(r=>r.b&&r.w>=2&&r.y>=panel.y0&&r.y<=panel.y1).filter(b=>b.y1-b.y0>=3).at(-1);if(!band)return null;
 const h=band.y1-band.y0+1,pad=Math.round(h*.7);
 return{h,crop:clampRect({x:corner.x+blue.x+blue.w*.28,y:corner.y+band.y0-pad,w:blue.w*.72+2,h:h+2*pad},px.width,px.height)};
}
// Reads of that line, scaled so the text is as tall as in the reference screenshot (8px line read at 4-6x).
export const roomLineReads=h=>ROOM_READS.map(o=>({...o,scale:Math.max(1,Math.round(o.scale*9.5/h))}));
export const ROOM_CHARS='FreMakt<>0123456789 ';                  // whitelist: keeps "8" from reading as "g"
// Fallback when no panel is found: OCR over the corner.
export const ROOM_FIND={scale:3};                                   // gray, finds the title line
// White-on-blue title, levels stretched (90-230) then inverted and thresholded: plain thresholding drops the digit at some display
// scalings ("Free Market <>"), and gray reads turn 8 into 6, so they are never used.
export const ROOM_READS=[4,5,6,7].map(scale=>({scale,binarize:true,levels:[90,230]}));
export const findRoomLine=words=>rowsOf(words).find(l=>/fr[e3]{2}\s*mar/i.test(l.text))||null;
// Just the "Free Market <8>" line; wider would take in the minimap's buttons, which spoil the number.
export const roomLineCrop=(line,W,H)=>clampRect({x:line.x-line.h*.5,y:line.y-line.h*.45,w:line.w+line.h,h:line.h*1.9},W,H);
export function parseRoom(text){const m=String(text||'').match(/mar\S*\s*[<({[«]\s*(\d{1,2})\s*[>)}\]»]/i);const n=m?+m[1]:0;return n>=1&&n<=99?n:null;}
// Two readings that agree, else none.
export function agreedRoom(texts){const rooms=texts.map(parseRoom).filter(Boolean);return rooms.find((r,i)=>rooms.indexOf(r)!==i)??null;}

// ---- World and channel ----
const gray=(px,x,y)=>{const p=(y*px.width+x)*4,[r,g,b]=[px.data[p],px.data[p+1],px.data[p+2]];return Math.abs(r-g)<=8&&Math.abs(g-b)<=10&&r>=150&&r<=215;};
const chosen=(px,x,y)=>{const p=(y*px.width+x)*4,[r,g,b]=[px.data[p],px.data[p+1],px.data[p+2]];return b>=175&&r<=130&&g>=120&&g<=210&&b-r>=80;};
function components(px,test){
 const {width:W,height:H}=px,seen=new Uint8Array(W*H),out=[],stack=[];
 for(let i=0;i<W*H;i++){if(seen[i]||!test(px,i%W,(i/W)|0))continue;
  let x0=W,y0=H,x1=0,y1=0,n=0;seen[i]=1;stack.push(i);
  while(stack.length){const j=stack.pop(),x=j%W,y=(j/W)|0;n++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(const k of [j-1,j+1,j-W,j+W]){if(k<0||k>=W*H||seen[k]||(k===j-1&&x===0)||(k===j+1&&x===W-1))continue;if(test(px,k%W,(k/W)|0)){seen[k]=1;stack.push(k);}}}
  out.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,n});}
 return out;
}
const cellLike=c=>c.w>=18&&c.w<=160&&c.h>=8&&c.h<=50&&c.w/c.h>=1.8&&c.w/c.h<=7&&c.n>=c.w*c.h*.45;
const cluster=(values,tol)=>{const out=[];for(const v of [...values].sort((a,b)=>a-b)){const last=out.at(-1);if(last&&v-last.at(-1)<=tol)last.push(v);else out.push([v]);}return out.map(g=>g.reduce((a,b)=>a+b,0)/g.length);};
// The Change Channel grid: grey cells in rows and columns plus one blue cell. Channels count row by row from 1, so the blue
// cell's position gives the channel exactly (its small white-on-blue label reads poorly).
export function channelGrid(px){
 const cells=components(px,gray).filter(cellLike);if(cells.length<8)return null;
 const ws=cells.map(c=>c.w).sort((a,b)=>a-b),hs=cells.map(c=>c.h).sort((a,b)=>a-b),cw=ws[ws.length>>1],ch=hs[hs.length>>1];
 const same=c=>Math.abs(c.w-cw)<=cw*.15&&Math.abs(c.h-ch)<=ch*.25;
 const grid=cells.filter(same);
 const blue=components(px,chosen).filter(c=>cellLike(c)&&same(c));
 const all=[...grid,...blue],cols=cluster(all.map(c=>c.x),Math.max(3,cw*.15)),rows=cluster(all.map(c=>c.y),Math.max(3,ch*.3));
 // Columns and rows must be evenly spaced, as in the game's menu.
 const even=v=>{if(v.length<2)return false;const d=v.slice(1).map((x,i)=>x-v[i]);return d.every(x=>Math.abs(x-d[0])<=Math.max(3,d[0]*.12));};
 if(cols.length<4||rows.length<2||!even(cols)||!even(rows)||grid.length<cols.length*(rows.length-1))return null;
 const at=(c,v,tol)=>v.findIndex(x=>Math.abs(x-c)<=tol);
 const picks=blue.map(c=>({c,col:at(c.x,cols,Math.max(3,cw*.15)),row:at(c.y,rows,Math.max(3,ch*.3))})).filter(p=>p.col>=0&&p.row>=0);
 if(picks.length!==1)return null;
 const {c,col,row}=picks[0];
 return{channel:row*cols.length+col+1,cell:{x:c.x,y:c.y,w:c.w,h:c.h},columns:cols.length,rows:rows.length,top:rows[0],left:cols[0],cellW:cw,cellH:ch};
}
// The world name sits in the band above the grid ("WINDIA").
export const worldBand=(grid,W,H)=>clampRect({x:grid.left,y:grid.top-grid.cellH*2.6,w:grid.cellW*4,h:grid.cellH*2.1},W,H);
export const WORLD_READS=[{scale:4,binarize:true}];  // block mode (psm 6): the wing icon precedes the name
export function parseWorld(text){const m=String(text||'').match(/[A-Za-z]{3,16}/g);if(!m)return null;const w=m.sort((a,b)=>b.length-a.length)[0];return w[0].toUpperCase()+w.slice(1).toLowerCase();}

// ---- The owner's store list ----
// Left of the shop chat window, as wide as the chat and as tall; includes the list's icons and scrollbar, which parsing skips.
export const storeListArea=(chat,W,H)=>clampRect({x:chat.x-chat.w,y:chat.y,w:chat.w,h:chat.h},W,H);
// The store title bar is above the list; its topmost confident line names the store.
export const storeTitleArea=(chat,W,H)=>clampRect({x:chat.x-chat.w,y:chat.y-chat.h*.75,w:chat.w*2,h:chat.h*.72},W,H);
// Normal reading for dark (unsold) rows, stretched levels for the faint grey of sold rows.
export const LIST_READS=[{scale:4,levels:[170,245]},{scale:6}];
export const TITLE_READ={scale:3};
const PRICE_LINE=/m[e3][s5][o0][s5]?\b/i;
const name=text=>String(text||'').replace(/^(?:\S{1,2}\s+)+(?=[A-Za-z]{3})/,'').replace(/^[^A-Za-z]+/,'').replace(/[^A-Za-z0-9')\]]+$/,'').replace(/\s+/g,' ').trim();
// "1 for 125 mesos", "11or 124 mesos" ("f" read as "1"), "110r1,679 mesos": the bundle price is the last number before "mesos";
// the quantity only from a clean "N for".
export function parsePriceLine(text){
 const t=String(text||'');const m=t.match(/(\d[\d,.]*\d|\d)\s*m[e3][s5][o0][s5]?\b/i);if(!m)return null;
 const bundle=+m[1].replace(/[,.]/g,'');if(!Number.isSafeInteger(bundle)||bundle<1)return null;
 const q=t.match(/(?:^|\s)(\d{1,4})\s+f[o0]r\s/i);const qty=q?+q[1]:1;
 return{qty,qtyKnown:!!q,bundle,price:Math.max(1,Math.round(bundle/qty))};
}
// Rows from one reading: a price line and the name line just above it.
export function parseStoreRows(words){
 const lines=rowsOf(words),rows=[],gaps=[];
 for(const [i,line] of lines.entries()){
  if(!PRICE_LINE.test(line.text))continue;const price=parsePriceLine(line.text);if(!price)continue;
  // The name row: letters, under the price text's columns, at the usual spacing above the price (character name tags and icon
  // noise land on rows in between). A name split into segments ("Sapphire" "Earrings") is joined.
  const h=line.h,near=lines.slice(0,i).filter(l=>!PRICE_LINE.test(l.text)&&/[A-Za-z]{3}/.test(l.text)&&line.y-l.y>0&&line.y-l.y<Math.max(h,10)*2.8&&l.x+l.w>line.x+h&&l.x<line.x+line.w);
  if(!near.length)continue;
  const gap=gaps.length?gaps.slice().sort((p,q)=>p-q)[gaps.length>>1]:null;
  const first=near.sort((p,q)=>gap===null?q.y-p.y:Math.abs(line.y-p.y-gap)-Math.abs(line.y-q.y-gap))[0];
  if(near.length===1)gaps.push(line.y-first.y);
  const parts=lines.filter(l=>Math.abs(l.y-first.y)<first.h*.6&&l.x+l.w>line.x&&l.x<line.x+line.w).sort((p,q)=>p.x-q.x);
  const above={...first,text:parts.map(l=>l.text).join(' '),x:Math.min(...parts.map(l=>l.x)),w:Math.max(...parts.map(l=>l.x+l.w))-Math.min(...parts.map(l=>l.x))};
  const item=name(above.text);if(!item||item.length<3)continue;
  const top=above.y,left=Math.min(above.x,line.x);
  rows.push({item,...price,box:{x:left,y:top,w:Math.max(above.x+above.w,line.x+line.w)-left,h:line.y+line.h-top},priceBox:{x:line.x,y:line.y,w:line.w,h:line.h}});
 }
 return rows;
}
// The icon cell sits immediately left of the name/price block. Neighboring row
// spacing preserves its size across capture scaling and keeps crops in their own row.
export function storeIconArea(row,rows,W,H){
 const gaps=rows.filter(other=>other!==row).map(other=>Math.abs(other.box.y-row.box.y)).filter(gap=>gap>row.box.h);
 const pitch=gaps.length?Math.min(...gaps):row.box.h*1.8;
 const side=Math.min(pitch,row.box.h*2);
 const padding=side*.04;
 return clampRect({x:row.box.x-side-padding,y:row.box.y-(side-row.box.h)/2,w:side,h:side},W,H);
}
// Sold rows are drawn in light grey: no dark ink anywhere on the price line, but some grey ink (about 190 on a 244 background),
// so a box that slipped onto empty background is not taken for a sold row.
export function isSold(px,box){
 const r=clampRect(box,px.width,px.height);let min=255;
 for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)min=Math.min(min,lum(px,x,y));
 return min>120&&min<=225;
}
// The price and "mesos" end of a price line: the left part can reach the item icon, whose quantity badge stays dark when sold.
export const soldProbe=box=>({...box,x:box.x+box.w*.35,w:box.w*.65});
// Merge readings: one row per position (top to bottom), the first reading that found it wins.
export function mergeStoreRows(readings,px){
 const out=[];
 for(const rows of readings)for(const r of rows){if(out.some(o=>Math.abs(o.box.y-r.box.y)<r.box.h*.5))continue;out.push(r);}
 return out.sort((a,b)=>a.box.y-b.box.y).map(r=>({...r,sold:isSold(px,soldProbe(r.priceBox))}));
}
// ---- Publishing the store list automatically: only rows read with certainty ----
// A merged row's name line (from its top down to its price line), and a crop of a line with a little room around the text.
export const rowNameBox=r=>({x:r.box.x,y:r.box.y,w:r.box.w,h:Math.max(1,r.priceBox.y-r.box.y)});
export const lineBox=(b,W,H)=>clampRect({x:b.x-2,y:b.y-2,w:b.w+4,h:b.h+4},W,H);
// Each price line is re-read twice (gray and thresholded; sold rows with their faint grey stretched first).
export const PRICE_READS=[{scale:4},{scale:4,binarize:true},{scale:5,binarize:true}];
export const SOLD_LEVELS=[170,245];
export const PRICE_CHARS='0123456789,. formesFORMES';
// The quantity of "N for B mesos" as the whitelisted reads show it: "1 for", "1for", "11or" and "110r" ("f" read as 1, "o" as
// 0), "1 or" (the "f" lost). Leading noise from the item icon ("4 1 1for") is skipped. null when there is no "for".
export function readQty(text){
 const m=String(text||'').match(/(?:^|\D)(\d{1,4}?)\s*[f1]?\s*[o0]r\s*\d/i);const n=m?+m[1]:0;
 return n>=1&&n<=9999?n:null;
}
// The price counts only when two re-reads agree on the quantity and bundle price, and that bundle is what the list reading saw.
export function agreedPrice(row,texts){
 const reads=texts.map(t=>({qty:readQty(t),bundle:parsePriceLine(t)?.bundle})).filter(r=>r.qty&&r.bundle===row.bundle);
 const hit=reads.find((r,i)=>reads.some((q,j)=>j!==i&&q.qty===r.qty));
 return hit?{qty:hit.qty,bundle:hit.bundle,price:Math.max(1,Math.round(hit.bundle/hit.qty))}:null;
}
// What a scan changes in the store's published listings ({id,item_id,qty,price,stats,sold}): a row already published in the
// same state is refreshed, a for-sale row now sold is updated to sold, anything else is added. Listings not on screen are left
// alone (they may be scrolled out of view) and expire; sold ones are never removed.
export function planListingSync(existing,rows){
 const free=[...existing],updates=[],inserts=[];
 const same=(e,r)=>e.item_id===r.item_id&&e.qty===r.qty&&Number(e.price)===r.price&&JSON.stringify(e.stats||{})==='{}';
 for(const r of rows){
  const c=free.filter(e=>same(e,r)),hit=c.find(e=>!!e.sold===r.sold)||(r.sold?c.find(e=>!e.sold):null);
  if(hit){free.splice(free.indexOf(hit),1);updates.push({id:hit.id,patch:{sold:r.sold,active:true},nowSold:r.sold&&!hit.sold});}
  else inserts.push({item_id:r.item_id,qty:r.qty,price:r.price,sold:r.sold});
 }
 return{updates,inserts};
}
// The store title: the topmost confident line with letters, not one of the store's buttons or the mesos field.
export function storeTitle(words){
 const line=rowsOf(words).filter(l=>(l.conf??0)>=60&&/[A-Za-z]{2}/.test(l.text)&&!/sold\s*items|open\s*store|close\s*store|mesos|has\s+(?:entered|left)/i.test(l.text)).sort((a,b)=>a.y-b.y)[0];
 return line?name(line.text).slice(0,60):'';
}
export {locationText} from './location.mjs?v=loc-1';

// ---- Sold, active or uncertain, from how a row is drawn ----
// One text line's ink: the background is the common tone, the ink the darkest few percent, and its colour. Sold rows are
// drawn in a light neutral grey (ink about 200 on a 244 background); for-sale rows in dark ink (under 60).
export function lineInk(px,box){
 const r=clampRect(box,px.width,px.height),L=[],S=[];
 for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){const p=(y*px.width+x)*4,d=px.data;L.push(.299*d[p]+.587*d[p+1]+.114*d[p+2]);S.push(Math.max(d[p],d[p+1],d[p+2])-Math.min(d[p],d[p+1],d[p+2]));}
 const sorted=[...L].sort((a,b)=>a-b),bg=sorted[Math.floor(sorted.length*.6)],ink=sorted[Math.floor(sorted.length*.02)];
 const sat=L.map((l,i)=>l<bg-25?S[i]:-1).filter(v=>v>=0).sort((a,b)=>a-b);
 return{bg,ink,inkPixels:sat.length,inkSaturation:sat.length?sat[sat.length>>1]:null};
}
function lineState({bg,ink,inkPixels,inkSaturation}){
 if(inkPixels<12)return null;                                                            // no text in the box
 if(ink<=110&&bg-ink>=80)return'active';
 if(ink>=160&&ink<=232&&bg-ink>=25&&bg-ink<=75&&inkSaturation<=20)return'sold';          // faint, colourless, still legible
 return'uncertain';
}
// Both the name line and the price end of the "1 for ... mesos" line must look the same way; anything else is Uncertain.
export function rowState(px,nameBox,priceBox){
 const a=lineState(lineInk(px,nameBox)),b=lineState(lineInk(px,soldProbe(priceBox)));
 return a&&a===b?a:'uncertain';
}

// ---- The minimap's map line: an FM room or a named map ----
// Room reads use the digit whitelist; name reads are plain. Returns {locationType,roomNumber|mapName,confidence} or null.
export function readMapLine(roomTexts,nameTexts=[]){
 const rooms=roomTexts.map(parseRoom).filter(Boolean),room=agreedRoom(roomTexts);
 if(room)return{locationType:'FM_ROOM',roomNumber:room,mapName:null,confidence:Math.round(100*rooms.filter(r=>r===room).length/roomTexts.length)};
 const names=nameTexts.map(t=>cleanMapName(t)).filter(t=>t.length>=3);
 // Any read that says Free Market means an FM room whose number did not read: never a named map.
 if(names.some(looksLikeFm)||roomTexts.some(t=>/mar\S*\s*[<({[«]/i.test(t)))return null;
 const agreed=names.find((t,i)=>names.some((q,j)=>j!==i&&q.toLowerCase()===t.toLowerCase()));
 return agreed?{locationType:'NAMED_MAP',roomNumber:null,mapName:agreed,confidence:Math.round(100*names.filter(t=>t.toLowerCase()===agreed.toLowerCase()).length/nameTexts.length)}:null;
}
export const MAP_NAME_READS=[{scale:4,binarize:true},{scale:6,binarize:true},{scale:5,binarize:true}];
