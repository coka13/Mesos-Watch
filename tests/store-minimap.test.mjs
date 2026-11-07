import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {storeMinimap} from '../dist/fm-location.mjs';
const image=await Jimp.read(new URL('./fixtures/store-minimap-yellow.png',import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const found=storeMinimap(image.bitmap);
assert.ok(found?.marker);
assert.ok(Math.abs(found.map.x+found.marker.x-132)<2);
assert.ok(Math.abs(found.map.y+found.marker.y-127)<2);
const {data,width}=image.bitmap;
for(let y=120;y<134;y++)for(let x=125;x<139;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
assert.equal(storeMinimap(image.bitmap).marker,null);
console.log('Minimap: screenshot yellow position detected; missing marker stays unknown.');
