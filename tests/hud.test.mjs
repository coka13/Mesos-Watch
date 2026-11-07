// The status bar reader on real game captures, at the display scalings a shared window can have. What is checked first is what
// would corrupt a session: a wrong number must never come out, whatever else fails. Run with npm test; no OCR engine is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Jimp} from 'jimp';
import {findStatusBar,readBar,expFill,parseExp,parsePair,fillAgrees,closestJob,parseLevel,cleanCharacterName,identityAreas,MIN_MATCH} from '../dist/hud.mjs';

const fixture=f=>fileURLToPath(new URL('./fixtures/'+f+'.png',import.meta.url));
const pix=i=>({data:i.bitmap.data,width:i.bitmap.width,height:i.bitmap.height});
const TRUTH={'store-empty-sold':{exp:93965,pct:76.54,hp:851,hpMax:851,mp:1621,mpMax:1621},'store-fm-room':{exp:49732,pct:40.51,hp:851,hpMax:851,mp:1621,mpMax:1621},'store-fm-channel':{exp:49732,pct:40.51,hp:851,hpMax:851,mp:1621,mpMax:1621}};

// Text parsing, including the damage seen at low capture sizes.
assert.deepEqual(parseExp('93,965 76,54%'),{exp:93965,pct:76.54,used:9});
assert.deepEqual(parseExp('49 732 4051%',.405),{exp:49732,pct:40.51,used:9},'separators lost');
assert.deepEqual(parseExp('49,732 405114',.41),{exp:49732,pct:40.51,used:9},'separator lost, percent sign broken');
assert.deepEqual(parseExp('965 7,54%',.075),{exp:965,pct:7.54,used:6},'a low percentage has one whole digit');
assert.deepEqual(parseExp('1,234,567 100,00%'),{exp:1234567,pct:100,used:12});
assert.equal(parseExp('49 732 4051%'),null,'without the gauge an unclear line is no reading');
assert.equal(parseExp('garbage',.5),null);
assert.equal(parseExp('49,732 4',.4),null);
assert.equal(parseExp('49732 9051%',.41),null,'digits that disagree with the gauge are no reading');
assert.deepEqual(parsePair('851/851'),{cur:851,max:851});
assert.equal(parsePair('851/85'),null,'current above maximum');
assert.equal(parsePair('851'),null);
assert.ok(fillAgrees(76.54,.762));assert.ok(!fillAgrees(76.54,.70));
assert.equal(parseLevel(' 32 '),32);assert.equal(parseLevel('0'),null);assert.equal(parseLevel('3x'),null);assert.equal(parseLevel('999'),null);
const JOBS=JSON.parse(fs.readFileSync(new URL('../dist/classic-data.json',import.meta.url),'utf8')).jobs;
assert.equal(closestJob('Cleric',JOBS),'Cleric');assert.equal(closestJob('CTeric',JOBS),'Cleric');assert.equal(closestJob('F/P Wizard',JOBS),'F/P Wizard');assert.equal(closestJob('zzzzzz',JOBS),null);
assert.equal(cleanCharacterName(' Internaly '),'Internaly');assert.equal(cleanCharacterName('x'),null);

// Real captures at the scalings a shared window can have.
let frames=0,right=0,missed=0;const wrong=[];
for(const [file,t] of Object.entries(TRUTH)){
 const base=await Jimp.read(fixture(file));
 for(let s=.75;s<=2.21;s+=.05){
  const i=base.clone();i.resize({w:Math.round(base.bitmap.width*s),h:Math.round(base.bitmap.height*s)});
  const px=pix(i),bar=findStatusBar(px),label=file+' x'+s.toFixed(2);frames++;
  assert.ok(bar,'status bar found: '+label);
  assert.ok(bar.pitch>=bar.gaugeH*5&&bar.exp.w>=bar.pitch*.8,'bar geometry: '+label);
  assert.ok(Math.abs(expFill(px,bar)-t.pct/100)<=.02,'EXP gauge fill: '+label+' '+expFill(px,bar));
  const r=readBar(px,bar);
  if(r.exp===null)missed++;else if(r.exp===t.exp&&r.pct===t.pct)right++;else wrong.push(label+' read '+r.exp+' '+r.pct);
  if(r.hp!==null)assert.equal(r.hpMax>=r.hp,true,'HP within its maximum: '+label);
 }
}
assert.deepEqual(wrong,[],'no reading is ever wrong: doubtful digits must be refused instead');
assert.ok(right/frames>=.75,`exact EXP reads ${right}/${frames}`);
assert.ok(MIN_MATCH>=.7,'the confidence floor keeps misreads out');

// Captures without the bar, or with it scrolled out of the frame, must not produce one.
for(const file of ['store-reference','store-live-small','fm-room-16-sky','store-minimap-yellow'])assert.equal(findStatusBar(pix(await Jimp.read(fixture(file)))),null,file+' shows no status bar');
const a=await Jimp.read(fixture('store-empty-sold'));
const cropped=a.clone().crop({x:0,y:0,w:a.bitmap.width,h:900});assert.equal(findStatusBar(pix(cropped)),null,'bar cut off the capture');

// Covering the EXP text loses the reading but not the bar; nothing is invented.
const covered=a.clone(),bar=findStatusBar(pix(a));
{const d=covered.bitmap.data,W=covered.bitmap.width;for(let y=bar.hp.y-20;y<bar.hp.y;y++)for(let x=bar.exp.x;x<bar.exp.x+bar.exp.w;x++){const p=(y*W+x)*4;d[p]=60;d[p+1]=60;d[p+2]=60;}}
{const r=readBar(pix(covered),bar);assert.equal(r.exp,null,'covered text gives no reading');assert.ok(Math.abs(r.fill-.7654)<=.02,'the gauge is still measured');}

// The left end of the bar stays inside the capture.
{const areas=identityAreas(bar,a.bitmap.width,a.bitmap.height);for(const k of ['level','job','name'])assert.ok(areas[k].x>=0&&areas[k].y>=0&&areas[k].x+areas[k].w<=a.bitmap.width&&areas[k].y+areas[k].h<=a.bitmap.height,k);}

console.log(`Status bar: found in ${frames}/${frames} real capture scalings, ${right} exact, ${missed} refused, 0 wrong; no bar invented; covered text refused.`);
