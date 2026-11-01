import fs from 'node:fs';
const file='dist/app.js';let s=fs.readFileSync(file,'utf8');
s="import {sourcePoint,validRegion} from './capture-geometry.mjs';\n"+s;
s=s.replace(/function point\(e\)\{[^\n]+\}/,"function point(e){const b=preview.getBoundingClientRect();return sourcePoint({x:e.clientX,y:e.clientY},{x:b.left,y:b.top,width:b.width,height:b.height},{width:preview.width,height:preview.height});}");
s=s.replace("const baselineNote=document.createElement('p');",`const debugBox=document.createElement('details');debugBox.className='privacy';debugBox.innerHTML='<summary>Local capture diagnostics</summary><p>Coordinates and OCR from your selected store regions stay on this page. Do not share diagnostics containing private chat.</p><pre id="capture-debug"></pre>';preview.parentElement.after(debugBox);
function debugCapture(data){$('capture-debug').textContent=JSON.stringify({source:{width:video.videoWidth,height:video.videoHeight},regions,...data},null,2);}
video.addEventListener('resize',()=>{if(!stream)return;stop('Capture resolution changed. Re-detecting regions; review them before restarting.');regions={};layoutSig=null;debugCapture({failure:'Source resolution changed'});if(!busy&&!checking)autoDetect();});
const baselineNote=document.createElement('p');`);
s=s.replace("function crop(name,scale=1){", "function crop(name,scale=1){");
// Validate the region immediately before every crop, including manual regions.
s=s.replace(/const r=regions\[name\];/,"const r=regions[name];if(!validRegion(r,video.videoWidth,video.videoHeight))throw Error('Capture area moved outside the source. Run Auto Select again.');");
s=s.replace("const found=locateRegions(tsvWords(result.data.tsv),c.width,c.height,scale,coinScore);", "const found=locateRegions(tsvWords(result.data.tsv),c.width,c.height,scale,coinScore);debugCapture({detected:found,confidence:result.data.confidence,missing:['total','items','balance'].filter(k=>!found[k])});");
s=s.replace("return{total,balance,rawFirst:","debugCapture({total,balance,confidence:Math.min(t.data.confidence,t2.data.confidence),selectedItemOCR:[i.data.text,i2.data.text]});\n return{total,balance,rawFirst:");
s=s.replace("}catch(e){status('Auto-detection unavailable:","}catch(e){debugCapture({failure:e.message});status('Auto-detection unavailable:");
fs.writeFileSync(file,s);
