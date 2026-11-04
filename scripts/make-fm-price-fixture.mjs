// Records real Tesseract re-reads of each store row's price line (as the Store Watcher's automatic publishing makes them) for
// tests/fm-location.test.mjs:  node scripts/make-fm-price-fixture.mjs tests/fixtures/store-fm-prices.json
import fs from 'node:fs';import {Jimp} from 'jimp';import {createWorker} from 'tesseract.js';
import {tsvWords} from '../dist/locate.mjs';import * as fm from '../dist/fm-location.mjs';import {ocrImage} from '../dist/ocr-prep.mjs';
const fx=JSON.parse(fs.readFileSync('tests/fixtures/store-fm.ocr.json','utf8'));const img=await Jimp.read('tests/fixtures/store-fm-room.png');
const px={data:img.bitmap.data,width:img.bitmap.width,height:img.bitmap.height};
const rows=fm.mergeStoreRows(fx.room.list.reads.map((t,i)=>fm.parseStoreRows(fm.toSource(tsvWords(t),fx.room.list.area,fm.LIST_READS[i].scale))),px);
const w=await createWorker('eng');const out={};
for(const r of rows){const state=fm.rowState(px,fm.rowNameBox(r),r.priceBox),b=fm.lineBox(r.priceBox,px.width,px.height),texts=[];
 for(const o of fm.PRICE_READS){const i=ocrImage({...px,...(()=>{const c=img.clone().crop(b);return{data:c.bitmap.data,width:c.bitmap.width,height:c.bitmap.height};})()},{...o,levels:state==='sold'?fm.SOLD_LEVELS:null}),j=new Jimp({width:i.width,height:i.height});j.bitmap.data=Buffer.from(i.data);
  await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:fm.PRICE_CHARS});texts.push((await w.recognize(await j.getBuffer('image/png'))).data.text.trim());}
 out[r.item+'@'+Math.round(r.box.y)]={box:b,state,texts};console.log(r.item,state,texts,fm.agreedPrice(r,texts));}
await w.terminate();fs.writeFileSync(process.argv[2],JSON.stringify(out));
