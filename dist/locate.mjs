import {parseTotal} from './detection.mjs';
export function tsvWords(tsv){return String(tsv||'').split('\n').slice(1).map(row=>{const c=row.split('\t');return{level:+c[0],group:c.slice(1,5).join('-'),x:+c[6],y:+c[7],w:+c[8],h:+c[9],confidence:+c[10],text:c.slice(11).join('\t').trim()};}).filter(w=>w.level===5&&w.text&&w.w>0&&w.h>0);}
function union(words){const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));return{x,y,w:Math.max(...words.map(w=>w.x+w.w))-x,h:Math.max(...words.map(w=>w.y+w.h))-y};}
function phrase(words,a,b){for(let i=0;i<words.length-1;i++)if(a.test(words[i].text)&&b.test(words[i+1].text)&&Math.abs(words[i].y-words[i+1].y)<Math.max(words[i].h,words[i+1].h))return union(words.slice(i,i+2));return null;}
export function locateRegions(words,width,height,scale=1,coinScore=()=>0){
 const groups=new Map();for(const word of words){const row=groups.get(word.group)||[];row.push(word);groups.set(word.group,row);}const lines=[...groups.values()].map(ws=>({words:ws.sort((a,b)=>a.x-b.x),text:ws.map(w=>w.text).join(' '),...union(ws)}));
 let totalLabel=null,receivedLabel=null,soldTitle=null;
 for(const line of lines){totalLabel ||= phrase(line.words,/^total$/i,/^sales?[:;]?$/i);receivedLabel ||= phrase(line.words,/^total$/i,/^received[:;]?$/i);if(/sold\s*[il]tems/i.test(line.text))soldTitle=line;}
 const result={};let shop=null;
 const rect=r=>({x:Math.max(0,Math.floor(r.x/scale)),y:Math.max(0,Math.floor(r.y/scale)),w:Math.max(1,Math.ceil(Math.min(r.w,width-r.x)/scale)),h:Math.max(1,Math.ceil(Math.min(r.h,height-r.y)/scale))});
 if(totalLabel&&receivedLabel&&Math.abs(totalLabel.y-receivedLabel.y)<30*scale&&receivedLabel.x>totalLabel.x){
  const left=totalLabel.x-10*scale,right=receivedLabel.x+receivedLabel.w+12*scale;
  const nums=words.filter(w=>w.confidence>=65&&parseTotal(w.text)!==null&&w.x>=left&&w.x+w.w<receivedLabel.x&&w.y>=totalLabel.y+totalLabel.h*.6&&w.y<totalLabel.y+65*scale).sort((a,b)=>a.y-b.y);
  if(nums.length===1)result.total=rect({x:nums[0].x-2*scale,y:nums[0].y-2*scale,w:nums[0].w+4*scale,h:nums[0].h+4*scale});
  const title=soldTitle&&soldTitle.y<totalLabel.y&&soldTitle.x<right&&soldTitle.x+soldTitle.w>left?soldTitle:null;
  if(title){shop={x:left,y:title.y-6*scale,w:right-left,h:totalLabel.y+75*scale-title.y};const top=title.y+title.h+5*scale;if(totalLabel.y-top>15*scale)result.items=rect({x:left+4*scale,y:top,w:right-left-8*scale,h:totalLabel.y-top-4*scale});}
 }
 const inventory=lines.find(l=>/\binventory\b/i.test(l.text));
 const money=words.filter(w=>w.confidence>=70&&parseTotal(w.text)!==null&&w.w>=w.h&&(!shop||w.x<shop.x||w.x>shop.x+shop.w||w.y<shop.y||w.y>shop.y+shop.h)).filter(w=>!inventory||(w.y>inventory.y&&w.y<inventory.y+450*scale&&Math.abs(w.x-inventory.x)<230*scale)).map(w=>({word:w,score:coinScore(w)})).filter(c=>c.score>=.025).sort((a,b)=>b.score-a.score);
 // Never choose between multiple money-looking fields without a clear winner.
 if(money.length===1){const w=money[0].word;result.balance=rect({x:w.x-2*scale,y:w.y-2*scale,w:w.w+4*scale,h:w.h+4*scale});}
 return result;
}
