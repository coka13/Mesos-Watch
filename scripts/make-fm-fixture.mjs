// Records real Tesseract output for the Free Market location and store-list reads, the way app.js makes them, so
// tests/fm-location.test.mjs runs on genuine OCR.
//   node scripts/make-fm-fixture.mjs tests/fixtures/store-fm-room.png tests/fixtures/store-fm-channel.png tests/fixtures/store-fm.ocr.json
import fs from 'node:fs';
import {Jimp} from 'jimp';
import {createWorker} from 'tesseract.js';
import {frameScale,tsvWords,locateRegions,coinScorer} from '../dist/locate.mjs';
import {enhanceFramePixels} from '../dist/auto-select.mjs';
import {ocrImage} from '../dist/ocr-prep.mjs';
import * as fm from '../dist/fm-location.mjs';

const [roomFile,channelFile,output]=process.argv.slice(2);
if(!output)throw Error('usage: make-fm-fixture.mjs <room.png> <channel.png> <out.json>');
const worker=await createWorker('eng');
const pixelsOf=image=>({data:image.bitmap.data,width:image.bitmap.width,height:image.bitmap.height});
async function read(image,rect,options,psm,whitelist=''){
 const b=image.clone().crop({x:rect.x,y:rect.y,w:rect.w,h:rect.h}),i=ocrImage(pixelsOf(b),options),out=new Jimp({width:i.width,height:i.height});out.bitmap.data=Buffer.from(i.data);
 await worker.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:whitelist});
 const {data}=await worker.recognize(await out.getBuffer('image/png'),{},{text:true,tsv:true});
 return{text:data.text,tsv:data.tsv,confidence:data.confidence};
}

// Room screenshot: Auto Select (for the chat window), the minimap room, the store list and title.
const room=await Jimp.read(roomFile),W=room.bitmap.width,H=room.bitmap.height,scale=frameScale(W);
const scaled=room.clone().resize({w:Math.round(W*scale),h:Math.round(H*scale),mode:'nearestNeighbor'}),sp=pixelsOf(scaled);
let regions={};
for(const pass of [{name:'original',mode:'11'},{name:'contrast',mode:'11'},{name:'threshold',mode:'3'}]){
 const image=scaled.clone();if(pass.name!=='original')image.bitmap.data=Buffer.from(enhanceFramePixels(image.bitmap.data,pass.name==='threshold'));
 await worker.setParameters({tessedit_pageseg_mode:pass.mode,tessedit_char_whitelist:''});
 const {data}=await worker.recognize(await image.getBuffer('image/png'),{},{tsv:true});
 const r=locateRegions(tsvWords(data.tsv),sp.width,sp.height,scale,coinScorer(sp,scale),sp);if(r.items&&r.balance&&r.chat){regions=r;break;}
}
if(!regions.chat)throw Error('Auto Select found no shop chat in '+roomFile);
const corner=fm.roomCorner(W,H),find=await read(room,corner,fm.ROOM_FIND,'11');
const line=fm.findRoomLine(fm.toSource(tsvWords(find.tsv),corner,fm.ROOM_FIND.scale));
const lineCrop=line&&fm.roomLineCrop(line,W,H),roomReads=[];
if(lineCrop)for(const o of fm.ROOM_READS)roomReads.push((await read(room,lineCrop,o,'7')).text);
const area=fm.storeListArea(regions.chat,W,H),listReads=[];
for(const o of fm.LIST_READS)listReads.push((await read(room,area,o,'6')).tsv);
const titleArea=fm.storeTitleArea(regions.chat,W,H),title=await read(room,titleArea,fm.TITLE_READ,'11');

// Channel screenshot: the grid from pixels, then the world band.
const channel=await Jimp.read(channelFile),grid=fm.channelGrid(pixelsOf(channel)),worldReads=[];
if(grid)for(const o of fm.WORLD_READS)worldReads.push((await read(channel,fm.worldBand(grid,channel.bitmap.width,channel.bitmap.height),o,'6')).text);
await worker.terminate();

const result={tesseract:'6.0.1',room:{source:roomFile.replace(/^.*[\\/]/,''),chat:regions.chat,corner,find:find.tsv,lineCrop,reads:roomReads,list:{area,reads:listReads},title:{area:titleArea,tsv:title.tsv}},
 channel:{source:channelFile.replace(/^.*[\\/]/,''),grid,worldReads}};
fs.writeFileSync(output,JSON.stringify(result));
console.log('room line',line?.text,'->',roomReads.map(t=>t.trim()),'room',fm.agreedRoom(roomReads));
console.log('grid',grid&&{channel:grid.channel,columns:grid.columns,rows:grid.rows},'world',worldReads.map(t=>t.trim()),fm.parseWorld(worldReads[0]));
console.log('title',fm.storeTitle(fm.toSource(tsvWords(title.tsv),titleArea,fm.TITLE_READ.scale)));
const rows=fm.mergeStoreRows(listReads.map((t,i)=>fm.parseStoreRows(fm.toSource(tsvWords(t),area,fm.LIST_READS[i].scale))),pixelsOf(room));
for(const r of rows)console.log(' ',r.sold?'SOLD    ':'FOR SALE',r.item,r.qty+' for '+r.bundle);
