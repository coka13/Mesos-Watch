// Test frames made only of real game pixels. A real capture is enlarged to a size the status bar reads at, then its EXP digits are
// replaced by tiles cut from the same capture: the status bar shows every digit somewhere (HP 851, MP 1621, EXP 49,732 40.51).
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Jimp,loadFont} from 'jimp';
import {SANS_16_WHITE} from 'jimp/fonts';
import {findStatusBar,textAreas,glyphCells,isSeparator,readBar} from '../../dist/hud.mjs';
import {roomLine,roomCorner} from '../../dist/fm-location.mjs';

export const pix=i=>({data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height});
const FIXTURE=fileURLToPath(new URL('../fixtures/store-fm-room.png',import.meta.url)),SCALE=1.4;
export async function base(){
 const i=await Jimp.read(FIXTURE);i.resize({w:Math.round(i.bitmap.width*SCALE),h:Math.round(i.bitmap.height*SCALE)});
 const px=pix(i),bar=findStatusBar(px),a=textAreas(bar,px.width,px.height),adv=Math.round(a.advance*.84);
 // Each character's slot: one advance wide, centred on its ink, in source pixels.
 const line=(field,text)=>{
  const page=glyphCells(px,a[field],a.advance),cells=page.cells.filter(c=>!isSeparator(page,c)).slice(0,text.length);
  if(cells.length<text.length)throw Error(field+': expected '+text.length+' characters, saw '+cells.length);
  const slot=c=>({x:Math.round(a[field].x+(c.x+c.w/2)/page.k-adv/2),y:a[field].y,w:adv,h:a[field].h});
  return{slots:cells.map((c,i)=>({ch:text[i],...slot(c)})),separators:page.cells.filter(c=>isSeparator(page,c)).map(c=>({x:Math.floor(a[field].x+c.x/page.k)-1,y:a[field].y,w:Math.ceil(c.w/page.k)+2,h:a[field].h}))};
 };
 const exp=line('exp','497324051'),hp=line('hp','851/851'),mp=line('mp','1621/1621');
 const tiles={};for(const s of [...exp.slots,...hp.slots,...mp.slots])if(/\d/.test(s.ch)&&!tiles[s.ch])tiles[s.ch]=s;
 return{image:i,bar,a,exp,hp,mp,tiles,percent:null};
}
function paste(target,source,from,to){for(let y=0;y<from.h;y++)for(let x=0;x<from.w;x++){const s=((from.y+y)*source.bitmap.width+from.x+x)*4,d=((to.y+y)*target.bitmap.width+to.x+x)*4;for(let c=0;c<3;c++)target.bitmap.data[d+c]=source.bitmap.data[s+c];}}
// Clears a box to the bar's own background: its rows, as they are just left of the box.
function wipe(target,box){const W=target.bitmap.width,d=target.bitmap.data;for(let y=box.y;y<box.y+box.h;y++){const ref=(y*W+box.x-3)*4;for(let x=box.x;x<box.x+box.w;x++){const p=(y*W+x)*4;d[p]=d[ref];d[p+1]=d[ref+1];d[p+2]=d[ref+2];}}}
// A frame showing this EXP and percentage (the capture's digit count: 5 and 4), its gauge filled to match.
export function frame(b,{exp,pct,cover=false}){
 const out=b.image.clone(),bar=b.bar,digits=String(exp).padStart(5,'0')+pct.toFixed(2).padStart(5,'0').replace('.','');
 if(digits.length!==9)throw Error('frames keep the capture’s digit count');
 const first=b.exp.slots[0],last=b.exp.slots.at(-1);
 wipe(out,{x:first.x-1,y:first.y,w:last.x+last.w-first.x+2,h:first.h});
 for(const sep of b.exp.separators)paste(out,b.image,sep,sep);
 [...digits].forEach((ch,i)=>paste(out,b.image,b.tiles[ch],b.exp.slots[i]));
 const top=bar.hp.y,h=bar.gaugeH,W=out.bitmap.width,d=out.bitmap.data,src=b.image.bitmap.data,fillEnd=Math.round(bar.exp.w*pct/100);
 for(let y=top;y<top+h-1&&y<out.bitmap.height;y++)for(let x=0;x<bar.exp.w;x++){const p=(y*W+bar.exp.x+x)*4,from=(y*W+bar.exp.x+(x<fillEnd?3:bar.exp.w-4))*4;for(let c=0;c<3;c++)d[p+c]=src[from+c];}
 if(cover){const a=b.a.exp;for(let y=a.y;y<a.y+a.h;y++)for(let x=a.x;x<a.x+a.w;x++){const p=(y*W+x)*4;d[p]=62;d[p+1]=68;d[p+2]=72;}}
 return out;
}
// A synthetic map title: the real minimap panel with this name printed over its map line, in a stand-in font. No capture of a quest
// map exists yet, so this tests the path from pixels to quest progress, not how well the game's own font reads.
let font=null;
export async function titled(b,base,name){
 font??=await loadFont(SANS_16_WHITE);
 const out=base.clone(),px=pix(out),c=roomLine(px,roomCorner(px.width,px.height)).crop,W=out.bitmap.width,d=out.bitmap.data,h=c.h+6,y0=c.y-3;
 for(let y=y0;y<y0+h;y++)for(let x=c.x;x<c.x+c.w-2;x++){const p=(y*W+x)*4;d[p]=118;d[p+1]=156;d[p+2]=196;}
 const line=new Jimp({width:(c.w-4)*2,height:24,color:0x769cc4ff});line.print({font,x:2,y:2,text:name});
 line.resize({w:c.w-4,h:12});out.composite(line,c.x+1,y0+Math.round((h-12)/2));
 return out;
}
export async function writeFrames(dir,list){
 fs.mkdirSync(dir,{recursive:true});const b=await base();
 for(const [name,spec] of Object.entries(list)){
  const image=frame(b,spec);await image.write(path.join(dir,name+'.png'));
  if(!spec.cover&&!spec.unchecked){const px=pix(image),r=readBar(px,findStatusBar(px));if(r.exp!==spec.exp||r.pct!==spec.pct)throw Error(`frame ${name}: the reader sees ${r.exp} ${r.pct} (${r.raw.exp}), want ${spec.exp} ${spec.pct}`);}
 }
 return b;
}
