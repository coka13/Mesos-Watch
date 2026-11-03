// Records real Tesseract output for a reference screenshot so detection tests run on genuine OCR, not invented words.
// Mirrors the browser pipeline: nearest-neighbour upscale by frameScale(width), then the original/contrast/threshold passes.
//   node scripts/make-ocr-fixture.mjs tests/fixtures/store-reference.png tests/fixtures/store-reference.ocr.json
import fs from 'node:fs';
import {Jimp} from 'jimp';
import {createWorker} from 'tesseract.js';
import {frameScale,tsvWords,locateRegions,coinScorer} from '../dist/locate.mjs';
import {numericInkBounds} from '../dist/numeric-region.mjs';
import {ocrImage,TEXT_PASSES,NUMBER_PASSES} from '../dist/ocr-prep.mjs';
import {enhanceFramePixels} from '../dist/auto-select.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('usage: make-ocr-fixture.mjs <screenshot.png> <out.json>');
const source=await Jimp.read(input);
const {width,height}=source.bitmap,scale=frameScale(width);
const scaled=source.clone().resize({w:Math.round(width*scale),h:Math.round(height*scale),mode:'nearestNeighbor'});
const worker=await createWorker('eng');
const passes={};
for(const pass of [{name:'original',mode:'11'},{name:'contrast',mode:'11'},{name:'threshold',mode:'3'}]){
 const image=scaled.clone();
 if(pass.name!=='original')image.bitmap.data=Buffer.from(enhanceFramePixels(image.bitmap.data,pass.name==='threshold'));
 await worker.setParameters({tessedit_pageseg_mode:pass.mode});
 const {data}=await worker.recognize(await image.getBuffer('image/png'),{},{tsv:true,text:true});
 passes[pass.name]={tsv:data.tsv,confidence:data.confidence};
 console.log(pass.name,data.confidence);
}
// Region crops, read the way app.js reads them.
const coin=coinScorer({data:scaled.bitmap.data,width:scaled.bitmap.width,height:scaled.bitmap.height},scale);
// Regions from the pass Auto Select would keep: the first with Sold Items and mesos, else the one finding most.
const pixels={data:scaled.bitmap.data,width:scaled.bitmap.width,height:scaled.bitmap.height};
const found=Object.values(passes).map(p=>locateRegions(tsvWords(p.tsv),scaled.bitmap.width,scaled.bitmap.height,scale,coin,pixels));
const regions=found.find(r=>r.items&&r.balance)||found.sort((a,b)=>Object.keys(b).length-Object.keys(a).length)[0];
// Same preprocessing as app.js (ocr-prep.mjs) on a 1:1 crop; the passes each region gets there.
const prepare=options=>{const i=ocrImage(cropped,options),out=new Jimp({width:i.width,height:i.height});out.bitmap.data=Buffer.from(i.data);return out.getBuffer('image/png');};
let cropped;
const crops={};
for(const [key,mode,whitelist,ocrPasses] of [['balance','7','0123456789, .',NUMBER_PASSES],['items','6','',TEXT_PASSES],['chat','6','',TEXT_PASSES.slice(0,1)]]){
 if(!regions[key])continue;
 const r=regions[key].text||regions[key],b=source.clone().crop({x:r.x,y:r.y,w:r.w,h:r.h}).bitmap;cropped={data:b.data,width:b.width,height:b.height};
 if(key==='balance'){const ink=numericInkBounds(cropped,1);if(ink){const t=source.clone().crop({x:r.x+ink.x,y:r.y+ink.y,w:ink.w,h:ink.h}).bitmap;cropped={data:t.data,width:t.width,height:t.height};}}
 await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:whitelist});
 const reads=[];for(const options of ocrPasses){const {data}=await worker.recognize(await prepare(options));reads.push({text:data.text,confidence:data.confidence});}
 crops[key]={region:regions[key],reads};console.log(key,JSON.stringify(reads.map(r=>[r.text.trim().slice(0,80),Math.round(r.confidence)])));
}
await worker.terminate();
fs.writeFileSync(output,JSON.stringify({source:input.replace(/^.*[\\/]/,''),width,height,scale,tesseract:'6.0.1',passes,crops}));
