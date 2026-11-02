import {locateRegions,tsvWords} from './locate.mjs?v=autoselect-4';
import {validRegion} from './capture-geometry.mjs';
export const ESSENTIAL_REGIONS=['total','items','balance'];
// All passes inspect one immutable frame. Never merge boxes from different frames or OCR interpretations.
export async function detectStoreRegions({recognize,width,height,scale,sourceWidth,sourceHeight,coinScore,onProgress=()=>{},isCurrent=()=>true}){
 let best={regions:{},confidence:null,attempts:[],missing:[...ESSENTIAL_REGIONS]},bestScore=-1;
 for(const [index,pass]of [{name:'original',mode:'11'},{name:'contrast',mode:'11'},{name:'threshold',mode:'3'}].entries()){
  if(!isCurrent())return{...best,cancelled:true};
  onProgress({attempt:index+1,pass:pass.name});
  const {data}=await recognize(pass);
  if(!isCurrent())return{...best,cancelled:true};
  const words=tsvWords(data.tsv),regions=locateRegions(words,width,height,scale,coinScore);
  for(const key of ['total','items','balance','sale'])if(regions[key]&&!validRegion(regions[key],sourceWidth,sourceHeight))delete regions[key];
  const missing=ESSENTIAL_REGIONS.filter(key=>!regions[key]);
  const attempt={pass:pass.name,words:words.length,confidence:data.confidence??null,missing};
  best.attempts.push(attempt);
  const score=(3-missing.length)*10-(regions.totalEstimated?1:0)-(regions.itemsEstimated?1:0);
  if(score>bestScore){best={regions,confidence:data.confidence??null,attempts:best.attempts,missing};bestScore=score;}
  if(!missing.length&&!regions.totalEstimated&&!regions.itemsEstimated)break;
 }
 return best;
}
// Same size and origin as the source image: preprocessing must never add borders to detection coordinates.
export function enhanceFramePixels(input,threshold=false){
 const output=new Uint8ClampedArray(input);
 for(let p=0;p<output.length;p+=4){const value=.299*input[p]+.587*input[p+1]+.114*input[p+2];const gray=threshold?(value<165?0:255):Math.max(0,Math.min(255,(value-128)*1.8+128));output[p]=output[p+1]=output[p+2]=gray;}
 return output;
}
