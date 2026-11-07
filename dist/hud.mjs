// The game's status bar, read from the shared window's pixels. Pure functions over RGBA {data,width,height}, shared by the
// Companion and the tests; nothing here touches the DOM, and nothing leaves the browser.
//   LV. 32 · Cleric · Internaly · HP[851/851] · MP[1621/1621] · EXP. 93,965[76.54%]
// The HP and MP gauges locate the bar at any capture size. Numbers are read by a small glyph matcher: they are drawn in one
// fixed-pitch bitmap font about 7 pixels tall, which general OCR reads poorly and which this reads in about a millisecond, so
// every frame can be checked. The EXP gauge's fill is measured separately and has to agree with the percentage read as text.
import {upscaleGray} from './ocr-prep.mjs?v=prep-2';
import {GLYPHS,GLYPH_W,GLYPH_H} from './hud-glyphs.mjs?v=1';

const at=(px,x,y)=>{const i=(y*px.width+x)*4,d=px.data;return[d[i],d[i+1],d[i+2]];};
const clampRect=(r,W,H)=>{const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y));return{x,y,w:Math.max(1,Math.min(W,Math.ceil(r.x+r.w))-x),h:Math.max(1,Math.min(H,Math.ceil(r.y+r.h))-y)};};
const hpFill=(r,g,b)=>r>=115&&g<=95&&b<=90&&r-g>=90;
const mpFill=(r,g,b)=>b>=120&&r<=95&&g>=40&&g<=200&&b-r>=80;
// Filled part of the EXP gauge: lime to green, no blue. Empty part: neutral grey. Both are measured along the gauge's middle row.
const expFilled=(r,g,b)=>g>=150&&b<=90&&g-b>=90&&r<=235;
const gaugeEmpty=(r,g,b)=>Math.abs(r-g)<=10&&Math.abs(g-b)<=10&&r>=120;

function runs(px,y,x0,x1,test,gap){
 const out=[];let start=-1,last=-1;
 for(let x=x0;x<x1;x++){const [r,g,b]=at(px,x,y);if(test(r,g,b)){if(start<0)start=x;last=x;}else if(start>=0&&x-last>gap){out.push({x:start,w:last-start+1});start=-1;}}
 if(start>=0)out.push({x:start,w:last-start+1});
 return out;
}
// Vertical extent of a gauge's colour: the tallest of a few columns, because glossy rows break it in some of them.
function column(px,x,w,y,test){
 let best=null;
 for(const c of [x+w*.2,x+w*.5,x+w*.8].map(Math.round)){
  if(!test(...at(px,c,y)))continue;
  let top=y,bottom=y,miss=0;
  for(let v=y-1;v>=0&&miss<3;v--){if(test(...at(px,c,v))){top=v;miss=0;}else miss++;}
  miss=0;for(let v=y+1;v<px.height&&miss<3;v++){if(test(...at(px,c,v))){bottom=v;miss=0;}else miss++;}
  if(!best||bottom-top+1>best.h)best={y:top,h:bottom-top+1};
 }
 return best;
}

// The bar sits along the bottom of the game. HP and MP are side by side on one line; EXP follows MP, a little longer. Their left
// edges and spacing fix the rest of the bar, however empty the gauges are. Returns null when no bar is seen. `from` is the share of
// the height to start at: 0 when px is already just the bottom of the game.
export function findStatusBar(px,from=.72){
 const {width:W,height:H}=px,y0=Math.floor(H*from),seen=new Set();let best=null;
 for(let y=y0;y<H;y+=2){
  for(const hp of runs(px,y,0,W,hpFill,2)){
   const key=hp.x+':'+hp.w;if(hp.w<8||seen.has(key))continue;seen.add(key);
   const v=column(px,hp.x,hp.w,y,hpFill);if(!v||v.h<6||v.h>40)continue;
   const row=v.y+(v.h>>1),reach=Math.min(W,hp.x+v.h*11);
   for(const mp of runs(px,row,hp.x+hp.w,reach,mpFill,2)){
    if(mp.w<8)continue;
    const m=column(px,mp.x,mp.w,row,mpFill);if(!m||Math.abs(m.y+m.h/2-(v.y+v.h/2))>v.h*.4)continue;
    const pitch=mp.x-hp.x,gaugeH=Math.max(v.h,m.h);if(pitch<gaugeH*5||pitch>gaugeH*11)continue;
    const exp=expGauge(px,mp.x+Math.round(pitch*1.02),row,pitch);if(!exp)continue;
    const score=mp.w+hp.w+exp.w,w=pitch-Math.round(gaugeH*.3);
    if(!best||score>best.score)best={score,hp:{x:hp.x,y:v.y,w,h:gaugeH},mp:{x:mp.x,y:v.y,w,h:gaugeH},exp,row,pitch,gaugeH};
   }
  }
 }
 if(!best)return null;
 const {score,...bar}=best;return bar;
}
// From the EXP gauge's left edge: filled, then empty, then the bar's dark frame. Returns its extent, or null if this is no gauge.
function expGauge(px,x0,row,pitch){
 const limit=Math.min(px.width,x0+Math.round(pitch*1.35));let best=null,start=-1,end=-1,miss=0;
 const close=()=>{if(start>=0&&(!best||end-start>best.w-1))best={x:start,w:end-start+1};start=-1;miss=0;};
 for(let x=Math.max(0,x0-Math.round(pitch*.05));x<limit;x++){
  const [r,g,b]=at(px,x,row);
  if(expFilled(r,g,b)||gaugeEmpty(r,g,b)){if(start<0)start=x;end=x;miss=0;}else if(start>=0&&++miss>Math.max(2,pitch*.02))close();
 }
 close();
 return best&&best.w>=pitch*.8?best:null;
}
// Share of the EXP gauge that is filled (0-1), from the same middle row.
export function expFill(px,bar){
 const {x,w}=bar.exp;let fill=0;
 for(let i=0;i<w;i++){const [r,g,b]=at(px,x+i,bar.row);if(expFilled(r,g,b))fill=i+1;}
 return fill/w;
}
// Gauges against the bar's geometry, for showing HP/MP warnings without reading text.
const share=(px,g,row,test)=>{let n=0;for(let i=0;i<g.w;i++){const [r,gg,b]=at(px,g.x+i,row);if(test(r,gg,b))n++;}return n/g.w;};
export const hpShare=(px,bar)=>share(px,bar.hp,bar.row,hpFill);
export const mpShare=(px,bar)=>share(px,bar.mp,bar.row,mpFill);

// ---- Where the text is ----
// The line of text sits directly above each gauge. Its size follows the gauges exactly: digits are ADVANCE of the HP-to-MP
// pitch apart, and each value starts just after its bold label.
const ADVANCE=.0566;
export function textAreas(bar,W,H){
 const top=bar.hp.y-bar.gaugeH*1.1,h=bar.gaugeH*.95,p=bar.pitch,area=(x,w)=>clampRect({x,y:top,w,h},W,H);
 return{hp:area(bar.hp.x+p*.165,p*.72),mp:area(bar.mp.x+p*.165,p*.72),exp:area(bar.exp.x+p*.205,bar.exp.w-p*.205),advance:p*ADVANCE};
}

// ---- Glyphs ----
// The smallest channel: the digits are neutral white, their brackets and the bar's sheen are tinted, so this keeps only digits.
function neutral(px,r){
 const data=new Uint8ClampedArray(r.w*r.h*4);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=((r.y+y)*px.width+r.x+x)*4,o=(y*r.w+x)*4,d=px.data,m=Math.min(d[i],d[i+1],d[i+2]);data[o]=data[o+1]=data[o+2]=m;data[o+3]=255;}
 return{data,width:r.w,height:r.h};
}
const SCALE_TO=60;                                          // upscaled rows in a text area, whatever the capture size
// Glyph cells in a text area, in upscaled pixels: runs of columns with bright ink, within the band of rows that holds the text.
export function glyphCells(px,area,advance){
 const k=Math.max(3,Math.min(8,Math.round(SCALE_TO/area.h))),{gray,width:w,height:h}=upscaleGray(neutral(px,area),k),page={cells:[],gray,w,h,k,adv:advance*k};
 const sorted=Float32Array.from(gray).sort();page.bg=sorted[Math.floor(sorted.length*.5)];page.fg=sorted[Math.floor(sorted.length*.995)];
 if(page.fg-page.bg<35)return page;
 const on=page.bg+(page.fg-page.bg)*.42,rows=new Uint32Array(h),col=new Uint8Array(w);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(gray[y*w+x]>=on)rows[y]++;
 let band=null,start=-1;const rowOn=Math.max(2,w*.012);
 for(let y=0;y<=h;y++){const hit=y<h&&rows[y]>=rowOn&&rows[y]<w*.9;if(hit&&start<0)start=y;else if(!hit&&start>=0){if(!band||y-start>band.h)band={y:start,h:y-start};start=-1;}}
 if(!band||band.h<page.adv*.6)return page;
 page.band=band;
 for(let y=band.y;y<band.y+band.h;y++)for(let x=0;x<w;x++)if(gray[y*w+x]>=on)col[x]=1;
 let s=-1;
 for(let x=0;x<=w;x++){if(x<w&&col[x]){if(s<0)s=x;}else if(s>=0){page.cells.push({x:s,w:x-s,y:band.y,h:band.h});s=-1;}}
 // Ink touching the area's left edge is the end of the bold label. Characters that ran together are separated at the font's
 // advance; the percent sign is the one wide character.
 page.cells=page.cells.filter(c=>c.x>1).flatMap(c=>{const n=c.w/page.adv>=1.6?Math.round(c.w/page.adv):1;return Array.from({length:n},(_,i)=>({...c,x:Math.round(c.x+i*c.w/n),w:Math.round(c.w/n)}));});
 return page;
}
// One character as GLYPH_W x GLYPH_H ink values (0-1), box-averaged from a window one advance wide, so a thin "1" stays thin.
export function glyphImage({gray,w,fg,bg,adv},c){
 const out=new Float32Array(GLYPH_W*GLYPH_H),wide=Math.max(adv,c.w),left=c.x+c.w/2-wide/2;
 for(let gy=0;gy<GLYPH_H;gy++)for(let gx=0;gx<GLYPH_W;gx++){
  const x0=left+gx*wide/GLYPH_W,x1=left+(gx+1)*wide/GLYPH_W,y0=c.y+gy*c.h/GLYPH_H,y1=c.y+(gy+1)*c.h/GLYPH_H;let sum=0,n=0;
  for(let y=Math.floor(y0);y<Math.max(Math.ceil(y1),Math.floor(y0)+1);y++)for(let x=Math.floor(x0);x<Math.max(Math.ceil(x1),Math.floor(x0)+1);x++){const v=x<0||x>=w?bg:gray[y*w+x];sum+=v;n++;}
  out[gy*GLYPH_W+gx]=Math.max(0,Math.min(1,(sum/n-bg)/(fg-bg)));
 }
 return out;
}
function correlation(a,b){
 let sa=0,sb=0;for(let i=0;i<a.length;i++){sa+=a[i];sb+=b[i];}sa/=a.length;sb/=a.length;
 let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-sa,y=b[i]-sb;n+=x*y;da+=x*x;db+=y*y;}
 return da&&db?n/Math.sqrt(da*db):0;
}
// The best character over its templates (each capture's blur gives its own) and shifts of a grid step, and how far it leads the
// runner-up. A low score or a thin lead means the shape is doubtful.
const shifted=(a,dx)=>{const o=new Float32Array(a.length);for(let y=0;y<GLYPH_H;y++)for(let x=0;x<GLYPH_W;x++){const s=x-dx;o[y*GLYPH_W+x]=s>=0&&s<GLYPH_W?a[y*GLYPH_W+s]:0;}return o;};
export function classify(image,templates=GLYPHS){
 let best='',score=-1,second=-1;
 const views=[image,shifted(image,1),shifted(image,-1)];
 for(const [ch,list] of Object.entries(templates)){
  let top=-1;for(const t of list)for(const v of views){const c=correlation(v,t);if(c>top)top=c;}
  if(top>score){if(best)second=score;score=top;best=ch;}else if(top>second)second=top;
 }
 return{ch:best,score,lead:score-second};
}
// A cell whose ink lies only at the foot of the line is "," or "."; the game draws them alike at this size.
export function isSeparator({gray,w,fg,bg},c){
 const on=bg+(fg-bg)*.42;let top=c.y+c.h;
 for(let y=c.y;y<c.y+c.h&&top===c.y+c.h;y++)for(let x=c.x;x<c.x+c.w;x++)if(gray[y*w+x]>=on){top=y;break;}
 return c.w<c.h*.4&&top-c.y>=c.h*.55;
}
// Text of an area, and how well each character matched. Gaps wider than a character become spaces; separators read as ",".
export function readGlyphs(px,area,advance,templates=GLYPHS){
 const page=glyphCells(px,area,advance);if(!page.cells.length)return{text:'',matches:[]};
 const out=[],matches=[];let end=null;
 for(const c of page.cells){
  if(end!==null&&c.x-end>page.adv*.75)out.push(' ');
  end=c.x+c.w;
  if(isSeparator(page,c)){if(out.at(-1)!==',')out.push(',');continue;}
  const r=classify(glyphImage(page,c),templates);out.push(r.ch);matches.push(r);
 }
 return{text:out.join(''),matches};
}

// ---- Values ----
const num=s=>Number(String(s).replace(/,/g,''));
// "851/851": current and maximum. Anything else, or a current above its maximum, is not a reading.
export function parsePair(text){
 const m=/^(\d{1,6})\/(\d{1,6})$/.exec(String(text||'').replace(/[ ,]/g,''));if(!m)return null;
 const cur=+m[1],max=+m[2];return max>=1&&cur<=max?{cur,max}:null;
}
// A percentage read as text must agree with the gauge beside it (measured within a percentage point on every test capture).
export const FILL_TOLERANCE=.02;
export const fillAgrees=(pct,fill)=>Math.abs(pct/100-fill)<=FILL_TOLERANCE;
// "93,965 76.54%": the amount, then the percentage. At some capture sizes the small separators vanish and the percent sign breaks
// into pieces, so a line in that exact shape is only the easy case. Otherwise the digits decide: the percentage is the last four
// or so digits on the line (at most a broken percent sign follows), and only one position in the line can match the gauge's fill.
export function parseExp(text,fill=null){
 const t=String(text||'').trim(),m=/^(\d{1,3}(?:,\d{3})*) (\d{1,3}),(\d{2})%$/.exec(t);
 if(m)return plausibleExp(num(m[1]),+(m[2]+'.'+m[3]),t.replace(/[ ,%]/g,'').length);
 if(fill===null)return null;
 // The gap and the decimal separator survived, and only the percent sign is damaged: they settle where the amount ends.
 const gap=t.lastIndexOf(' '),split=gap>0&&/^[\d, ]+$/.test(t.slice(0,gap))?/^(\d{1,3}),(\d{2})/.exec(t.slice(gap+1)):null;
 if(split){const head=t.slice(0,gap).replace(/[ ,]/g,''),pct=+(split[1]+'.'+split[2]);if(fillAgrees(pct,fill))return plausibleExp(+head,pct,head.length+split[1].length+2);}
 const s=t.replace(/[ ,]/g,''),need=(fill>=.98?3:fill>=.08?2:1)+2;
 for(let i=s.length-need;i>=1&&s.length-i-need<=4;i--){
  const head=s.slice(0,i),tail=s.slice(i,i+need);if(!/^\d+$/.test(head)||!/^\d+$/.test(tail))continue;
  const pct=+(tail.slice(0,-2)+'.'+tail.slice(-2));if(fillAgrees(pct,fill))return plausibleExp(+head,pct,i+need);
 }
 return null;
}
const plausibleExp=(exp,pct,used)=>Number.isSafeInteger(exp)&&pct<=100?{exp,pct,used}:null;
// The weakest of the digits a value was read from. Below MIN_MATCH a digit is too doubtful to count: no misread in the test
// sweep (tests/hud.test.mjs) reached it, and a skipped frame costs nothing, where a wrong number would corrupt the session.
export const MIN_MATCH=.72;
export const worstMatch=(matches,used=matches.length)=>matches.slice(0,used).reduce((m,r)=>Math.min(m,r.score),1);

// Everything on the bar at once. A field is null when it could not be read with confidence.
export function readBar(px,bar){
 const areas=textAreas(bar,px.width,px.height),read=k=>readGlyphs(px,areas[k],areas.advance),expText=read('exp'),hpText=read('hp'),mpText=read('mp');
 const fill=expFill(px,bar),parsed=parseExp(expText.text,fill),match=parsed?worstMatch(expText.matches,parsed.used):0,exp=parsed&&fillAgrees(parsed.pct,fill)&&match>=MIN_MATCH?parsed:null;
 const pair=r=>worstMatch(r.matches)>=MIN_MATCH?parsePair(r.text):null,hp=pair(hpText),mp=pair(mpText);
 return{exp:exp?.exp??null,pct:exp?.pct??null,fill,hp:hp?.cur??null,hpMax:hp?.max??null,mp:mp?.cur??null,mpMax:mp?.max??null,match,raw:{exp:expText.text,hp:hpText.text,mp:mpText.text}};
}

// ---- Left end of the bar ----
// Level, job and name are not in the digit font: the Companion reads these three with OCR, only when they may have changed.
export function identityAreas(bar,W,H){
 const p=bar.pitch,x=bar.hp.x,y=bar.hp.y,h=bar.gaugeH,area=r=>clampRect(r,W,H);
 return{level:area({x:x-p*1.66,y:y-h*.9,w:p*.34,h:h*1.75}),job:area({x:x-p*1.3,y:y-h*1.15,w:p*1.05,h:h*1.05}),name:area({x:x-p*1.3,y:y-h*.05,w:p*1.05,h:h*1.05})};
}
export const levelPixels=neutral;
export const readScale=(area,target)=>Math.max(3,Math.round(target/area.h));
export function parseLevel(text){const m=/^\s*(\d{1,3})\s*$/.exec(String(text||''));const n=m?+m[1]:0;return n>=1&&n<=200?n:null;}
export function editDistance(a,b){
 const d=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){let p=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]===b[j-1]?0:1));p=t;}}
 return d[b.length];
}
// A read of the job line, snapped to the game's jobs. Too far from all of them is no reading.
export function closestJob(text,jobs){
 const t=String(text||'').toLowerCase().replace(/[^a-z/]/g,'');if(t.length<3)return null;
 let best=null,dist=Infinity;
 for(const j of jobs){const v=editDistance(t,j.toLowerCase().replace(/[^a-z/]/g,''));if(v<dist){dist=v;best=j;}}
 return dist<=Math.max(1,Math.floor(best.length/3))?best:null;
}
// A character name: letters and digits only in-game, and only once two reads agree (the caller compares them).
export const cleanCharacterName=t=>{const m=String(t||'').trim().replace(/[^A-Za-z0-9]/g,'');return m.length>=2&&m.length<=12?m:null;};
