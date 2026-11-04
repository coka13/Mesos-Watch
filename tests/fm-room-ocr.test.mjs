// FM room recognition end to end with real Tesseract, as the FM Scanner and Store Watcher run it: the minimap title panel
// found from pixels, its map line read with the digit whitelist at scales matched to the text height. Both reference
// screenshots at display scalings 1x-2x and inside a 1920x1080 full-screen share must give room 8, never another number.
// Slow (about a minute; needs eng.traineddata): npm run test:ocr
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Jimp} from 'jimp';import {createWorker} from 'tesseract.js';
import {ocrImage} from '../dist/ocr-prep.mjs';import * as fm from '../dist/fm-location.mjs';
const w=await createWorker('eng');
const pix=i=>({data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height});
async function read(img,rect,o,wl){const b=img.clone().crop({x:rect.x,y:rect.y,w:rect.w,h:rect.h}),p=ocrImage(pix(b),o),out=new Jimp({width:p.width,height:p.height});out.bitmap.data=Buffer.from(p.data);
 await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:wl});return (await w.recognize(await out.getBuffer('image/png'))).data.text.trim();}
let n=0;
for(const src of ['store-fm-room','store-fm-channel'])for(const [s,canvas] of [[1,false],[1.25,false],[1.5,false],[2,false],[1,true]]){
 let i=await Jimp.read(fileURLToPath(new URL('./fixtures/'+src+'.png',import.meta.url)));if(s!==1)i.resize({w:Math.round(i.bitmap.width*s),h:Math.round(i.bitmap.height*s)});
 if(canvas){const c=new Jimp({width:1920,height:1080,color:0x202020ff});c.composite(i,0,32);i=c;}
 const px=pix(i),found=fm.roomLine(px,fm.roomCorner(px.width,px.height)),label=src+' at '+s+'x'+(canvas?' in 1080p':'');
 assert.ok(found,'title panel found: '+label);
 const texts=[];for(const o of fm.roomLineReads(found.h))texts.push(await read(i,found.crop,o,fm.ROOM_CHARS));
 const rooms=texts.map(fm.parseRoom).filter(Boolean);
 assert.ok(rooms.every(r=>r===8),'no read gives another room: '+label+' '+JSON.stringify(texts));
 const res=fm.readMapLine(texts);
 assert.equal(res?.roomNumber,8,'room 8: '+label+' '+JSON.stringify(texts));
 assert.ok(res.confidence>=50,'confidence '+res.confidence);n++;
}
await w.terminate();
console.log('FM room OCR: room 8 read in '+n+' captures (two screenshots, 1x-2x scaling, 1080p share), no wrong numbers.');
