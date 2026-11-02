// Records real Tesseract output for a reference screenshot so detection tests run on genuine OCR, not invented words.
// Mirrors the browser pipeline: nearest-neighbour upscale by frameScale(width), then the original/contrast/threshold passes.
//   node scripts/make-ocr-fixture.mjs tests/fixtures/store-reference.png tests/fixtures/store-reference.ocr.json
import fs from 'node:fs';
import {Jimp} from 'jimp';
import {createWorker} from 'tesseract.js';
import {frameScale,tsvWords,locateRegions,coinScorer} from '../dist/locate.mjs';
import {numericInkBounds} from '../dist/numeric-region.mjs';
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
// Region crops, read the way app.js reads them: 4x nearest-neighbour, 20px white margin, contrast then threshold.
const coin=coinScorer({data:scaled.bitmap.data,width:scaled.bitmap.width,height:scaled.bitmap.height},scale);
const regions=locateRegions(tsvWords(passes.original.tsv),scaled.bitmap.width,scaled.bitmap.height,scale,coin);
const prepare=(image,threshold)=>{const out=new Jimp({width:image.bitmap.width+40,height:image.bitmap.height+40,color:0xffffffff});const d=image.bitmap.data;
 for(let p=0;p<d.length;p+=4){let v=.299*d[p]+.587*d[p+1]+.114*d[p+2];v=threshold?(v<165?0:255):Math.max(0,Math.min(255,(v-128)*1.4+128));d[p]=d[p+1]=d[p+2]=v;}
 out.composite(image,20,20);return out.getBuffer('image/png');};
const cropOf=(r,s=4)=>source.clone().crop({x:r.x,y:r.y,w:r.w,h:r.h}).resize({w:r.w*s,h:r.h*s,mode:'nearestNeighbor'});
const crops={};
for(const [key,mode,whitelist] of [['balance','7','0123456789, .'],['items','6',''],['chat','6','']]){
 if(!regions[key])continue;
 let image=cropOf(regions[key]);
 if(key==='balance'){const ink=numericInkBounds({data:image.bitmap.data,width:image.bitmap.width,height:image.bitmap.height},4);if(ink)image=image.crop({x:ink.x,y:ink.y,w:ink.w,h:ink.h});}
 await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:whitelist});
 const reads=[];for(const threshold of [false,true]){const {data}=await worker.recognize(await prepare(image.clone(),threshold));reads.push({text:data.text,confidence:data.confidence});}
 crops[key]={region:regions[key],reads};console.log(key,JSON.stringify(reads.map(r=>[r.text.trim().slice(0,80),Math.round(r.confidence)])));
}
await worker.terminate();
fs.writeFileSync(output,JSON.stringify({source:input.replace(/^.*[\\/]/,''),width,height,scale,tesseract:'6.0.1',passes,crops}));
