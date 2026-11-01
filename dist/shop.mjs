// Reads a player shop from full-frame OCR words (tsvWords): item-name rows above "1 for 24,679 mesos" rows, the shop's title,
// the FM map when visible, and stats from a hovered item's tooltip.
import {rowsOf} from './locate.mjs?v=autoselect-3';
const PRICE=/^(\d{1,4})\s*f[o0]r\s*([\d][\d,.]*)\s*m[e3][s5][o0][s5]?[^A-Za-z0-9]*$/i;
// In full-frame OCR the small "1 for" often comes out as "ar"/"or" or vanishes: such rows are kept as unconfirmed and re-read.
const LOOSE=/^(?:[^\d\s]{1,3}\s+)?([\d][\d,.]{2,})\s*m[e3][s5][o0][s5]?[^A-Za-z0-9]*$/i;
const MIN_CONF=70;
// A targeted re-read of one line may carry a stray character from the row's edge.
export function parsePriceLine(text){const m=/^\s*(\d{1,4})\s*f[o0]r\s*(\d[\d,.]*)\s*m[e3]s[o0]s?\b/i.exec(String(text||''));if(!m)return null;const qty=+m[1],bundle=+m[2].replace(/[,.]/g,'');return qty>0&&bundle>0?{qty,price:Math.round(bundle/qty),bundle}:null;}
const BUTTONS=/^(sold items|open store|close store|buy|exit|ok|cancel|enter|purchase|visit|ban|blacklist|whisper)$/i;
const STATS=[[/^str$/i,'str'],[/^dex$/i,'dex'],[/^int$/i,'int'],[/^luk$/i,'luk'],[/^max\s*hp|^hp$/i,'hp'],[/^max\s*mp|^mp$/i,'mp'],
 [/^weapon\s*att(ack)?$/i,'watk'],[/^magic\s*att(ack)?$/i,'matk'],[/^weapon\s*def(ense)?$/i,'wdef'],[/^magic\s*def(ense)?$/i,'mdef'],
 [/^acc(uracy)?$/i,'acc'],[/^avoid(ability)?$/i,'avoid'],[/^speed$/i,'speed'],[/^jump$/i,'jump'],[/^(number of )?upgrades? available$/i,'slots']];

export const cleanName=t=>t.replace(/^[^A-Za-z0-9(]+/,'').replace(/[^A-Za-z0-9)%'.!+\-…]+$/,'').replace(/\s+/g,' ').trim();
const key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');

function statLine(text){
 const m=/^([A-Za-z .]+?)\s*[:;]\s*\+?\s*(\d{1,4})\b/.exec(text.trim());if(!m)return null;
 const found=STATS.find(([re])=>re.test(m[1].trim()));return found?[found[1],+m[2]]:null;
}

export function readShop(words){
 const lines=rowsOf(words),listings=[];
 for(const line of lines){
  const strict=PRICE.exec(line.text),loose=strict?null:LOOSE.exec(line.text);if(!strict&&!loose)continue;
  const qty=strict?+strict[1]:null,bundle=+(strict?strict[2]:loose[1]).replace(/[,.]/g,'');
  if(qty===0||!Number.isFinite(bundle)||bundle<1)continue;
  // The name sits one row up, starting at about the same x.
  const name=lines.filter(l=>l!==line&&!PRICE.test(l.text)&&!LOOSE.test(l.text)&&l.y<line.y&&line.y-l.y<line.h*2.6&&Math.abs(l.x-line.x)<line.h*3).sort((a,b)=>b.y-a.y)[0];
  if(!name)continue;
  const item=cleanName(name.text);
  if(item.length<2||/\b(buyer|number purchased|total sales|has (entered|left))\b/i.test(item)||/\S :/.test(name.text))continue;  // chat lines read "Name : message"
  const h=line.h;
  // certain: both rows read cleanly. Otherwise the scanner re-reads priceBox (and nameBox) enlarged before trusting the listing.
  const certain=!!strict&&line.conf>=MIN_CONF&&name.conf>=MIN_CONF,left=Math.min(name.x,line.x)-h*.4;
  listings.push({item,price:qty?Math.round(bundle/qty):bundle,qty,certain,nameConf:name.conf,stats:{},
   nameBox:{x:Math.round(name.x-h*.3),y:Math.round(name.y-h*.25),w:Math.round(name.w+h*.8),h:Math.round(name.h+h*.5)},
   priceBox:{x:Math.round(left),y:Math.round(line.y-h*.3),w:Math.round(line.x+line.w-left+h*.6),h:Math.round(line.h+h*.6)},box:{x:name.x,y:name.y,w:Math.max(name.w,line.x+line.w-name.x),h:line.y+line.h-name.y},icon:{x:Math.round(name.x-h*3.4),y:Math.round(name.y-h*.25),w:Math.round(h*2.9),h:Math.round(h*2.9)}});
 }
 if(!listings.length)return{listings,shopTitle:'',map:'',channel:null};

 // Title bar: the top line in the listing column, well above the first listing, that is not a button or a number.
 const first=listings.reduce((a,b)=>a.box.y<b.box.y?a:b),hh=first.box.h/2;
 const title=lines.filter(l=>l.y<first.box.y-hh*5&&first.box.y-l.y<hh*14&&l.x>first.box.x-hh*5&&l.x<first.box.x+hh*12&&l.conf>=40&&!BUTTONS.test(l.text.trim())&&/[A-Za-z]{2}/.test(l.text)&&!/^[\d,.\s]+$/.test(l.text)).sort((a,b)=>a.y-b.y)[0];
 const shopTitle=title?cleanName(title.text).slice(0,40):'';

 // Tooltip: a cluster of stat lines whose heading repeats one of the listed names (the item under the cursor).
 const statLines=lines.map(l=>({l,s:statLine(l.text)})).filter(x=>x.s);
 if(statLines.length){
  const top=Math.min(...statLines.map(x=>x.l.y)),left=Math.min(...statLines.map(x=>x.l.x));
  const heading=lines.filter(l=>l.y<top&&top-l.y<l.h*8&&Math.abs(l.x-left)<l.h*12).sort((a,b)=>b.y-a.y).find(l=>listings.some(x=>key(x.item)===key(cleanName(l.text))));
  if(heading){
   const target=listings.find(x=>key(x.item)===key(cleanName(heading.text)));
   const near=statLines.filter(x=>x.l.y>heading.y&&x.l.y-heading.y<heading.h*20);
   for(const {s:[k,v]} of near)target.stats[k]=v;
  }
 }
 const mapLine=lines.find(l=>/free\s*market/i.test(l.text)&&l.conf>=MIN_CONF);
 // Minimap titles read "<Free Market> Free Market Entrance": keep the room name after the region tag.
 const map=mapLine?cleanName(mapLine.text.replace(/^.*[>\]]\s*(?=\S)/,'').replace(/^[<\[]\s*/,'')).slice(0,40):'';
 const ch=lines.map(l=>/\bch(?:annel)?\.?\s*(\d{1,2})\b/i.exec(l.text)).find(Boolean);
 return{listings,shopTitle,map,channel:ch?+ch[1]:null};
}

export const readShopListings=words=>readShop(words).listings.filter(l=>l.certain).map(({item,price,qty})=>({item,price,qty}));

// Two scans must agree before a listing is trusted, as with sale totals.
export const listingKey=l=>l.item.toLowerCase()+'|'+l.price+'|'+JSON.stringify(l.stats||{});
export function confirmed(previous,current){const seen=new Set(previous.map(listingKey));return current.filter(l=>seen.has(listingKey(l)));}

// 64-bit average hash of an icon (8x8 grayscale), as 16 hex digits, for matching icons between players.
export function averageHash(gray8x8){const avg=gray8x8.reduce((a,b)=>a+b,0)/64;let hex='';for(let i=0;i<64;i+=4){let n=0;for(let j=0;j<4;j++)n=n*2+(gray8x8[i+j]>avg?1:0);hex+=n.toString(16);}return hex;}
export const shopKeyOf=(world,title,map)=>title?(world+'|'+map+'|'+title).toLowerCase().replace(/\s+/g,' ').slice(0,64):'';
