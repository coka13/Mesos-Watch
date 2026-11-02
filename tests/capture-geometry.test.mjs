import assert from 'node:assert/strict';
import {sourcePoint,validRegion} from '../dist/capture-geometry.mjs';
for(const zoom of [.5,1,1.25,2])assert.deepEqual(sourcePoint({x:100+320*zoom,y:50+180*zoom},{x:100,y:50,width:640*zoom,height:360*zoom},{width:1920,height:1080}),{x:960,y:540});
assert.throws(()=>sourcePoint({x:1,y:2},{x:0,y:0,width:0,height:1},{width:1,height:1}));
assert.equal(validRegion({x:1800,y:10,w:200,h:30},1920,1080),false);
assert.equal(validRegion({x:0,y:0,w:640,h:480},640,480),true);
assert.equal(validRegion({x:NaN,y:0,w:1,h:1},640,480),false);
console.log('Capture geometry: zoom, source bounds and invalid dimensions passed.');
