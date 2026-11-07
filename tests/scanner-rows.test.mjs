// What the FM Scanner decides about a shop before anything is published, on real captures.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Jimp} from 'jimp';
import {ownerControls,shopListArea,rowState} from '../dist/fm-location.mjs';
import {readShop,titleAbove} from '../dist/shop.mjs';

const fixture=f=>fileURLToPath(new URL('./fixtures/'+f+'.png',import.meta.url));
const pix=i=>({data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height});

// The owner's window is recognised from its buttons alone, at every display scaling, because OCR cannot be relied on to read them.
for(const [file,scales] of [['store-fm-room',[1,1.25,1.5,2]],['store-empty-sold',[.8,1,1.5]],['store-reference',[1,1.5]]])for(const s of scales){
 const i=await Jimp.read(fixture(file));if(s!==1)i.resize({w:Math.round(i.bitmap.width*s),h:Math.round(i.bitmap.height*s)});
 assert.equal(ownerControls(pix(i)),true,file+' x'+s+' is the owner’s window');
}
// With either button gone it is not: one colour alone proves nothing, and a false match would silently stop a real shop being published.
{const i=await Jimp.read(fixture('store-fm-room')),W=i.bitmap.width,d=i.bitmap.data;for(let y=228;y<252;y++)for(let x=468;x<546;x++){const p=(y*W+x)*4;d[p]=214;d[p+1]=212;d[p+2]=204;}assert.equal(ownerControls(pix(i)),false,'no orange button');}
assert.equal(ownerControls(pix(await Jimp.read(fixture('fm-room-16-sky')))),false,'a plain game scene');
assert.equal(ownerControls(pix(await Jimp.read(fixture('store-live-small')))),false,'only the lime button in frame');

// A price line where OCR turned the small "f" into a "t" is still a price line.
const word=(text,x,y,w=60,h=10)=>({text,x,y,w,h,confidence:90,level:5,group:'1'});
{const words=[word('Sapphire',100,100),word('Earrings',165,100),word('1',100,114,6),word('tor',110,114,18),word('7,679',132,114,32),word('mesos',170,114,36)];
 const s=readShop(words);assert.equal(s.listings.length,1);assert.equal(s.listings[0].price,7679);assert.equal(s.listings[0].qty,1);assert.equal(s.listings[0].item,'Sapphire Earrings');}

// The title is found from the topmost row, even one only the second pass could read.
{const lines=[{text:'Trash',x:370,y:152,w:40,h:10,conf:90},{text:'Close Store',x:480,y:234,w:50,h:10,conf:90}];
 assert.equal(titleAbove(lines,{x:393,y:277,w:90,h:30}).shopTitle,'Trash');assert.equal(titleAbove(lines,{x:393,y:600,w:90,h:30}).shopTitle,'','too far above to be this shop’s title');}

// The list area stays inside the frame and reaches the rows around the one it started from.
{const a=shopListArea({x:393,y:405,w:95,h:24},1137,648);assert.ok(a.x>=0&&a.y>=0&&a.x+a.w<=1137&&a.y+a.h<=648);assert.ok(a.y<=270&&a.y+a.h>=460,'six rows of 33 pixels: '+JSON.stringify(a));assert.ok(a.x<=365,'includes the icons');
 const edge=shopListArea({x:5,y:5,w:90,h:30},100,100);assert.ok(edge.x===0&&edge.y===0&&edge.w<=100&&edge.h<=100,'clamped');}

// Sold rows really are told from active ones on the real capture's pixels.
{const px=pix(await Jimp.read(fixture('store-fm-room')));
 assert.equal(rowState(px,{x:393,y:404,w:90,h:12},{x:385,y:416,w:100,h:13}),'active','Sapphire Earrings');
 assert.equal(rowState(px,{x:393,y:272,w:90,h:12},{x:385,y:284,w:100,h:13}),'sold','Orange Potion');}

console.log('Scanner rows: own store recognised from its buttons at every scaling, one button alone refused, damaged price lines kept, sold told from active.');
