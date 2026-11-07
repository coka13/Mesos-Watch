// Training sessions and quest progress: the rules that keep the numbers honest, with no screen involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as c from '../dist/companion-core.mjs';
import {ROUTES,findStage,closestMap,createQuestLog,observeMap,routeView} from '../dist/companion-quests.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../dist/classic-data.json',import.meta.url),'utf8'));
const NEED=122766,at=exp=>({exp,pct:Math.floor(exp/NEED*1e4)/100,hp:500,hpMax:851,mp:900,mpMax:1621});
const twice=(s,r,t)=>{c.observe(s,r,t);return c.observe(s,r,t+1000);};
const fresh=(exp=50000,t=0)=>{const s=c.createSession('a',t);twice(s,at(exp),t);return s;};

// The first reading is a start, not a gain, and needs a second frame.
{const s=c.createSession('a',0);assert.equal(c.observe(s,at(50000),0).outcome,'waiting');assert.equal(s.exp,null);
 assert.equal(c.observe(s,at(50000),1000).outcome,'baseline');assert.equal(s.exp,50000);assert.equal(s.gained,0);assert.equal(s.readingsCount,1);}
// Gains need two frames; repeated frames are not repeated gains.
{const s=fresh();assert.equal(c.observe(s,at(50100),5000).outcome,'waiting');assert.equal(s.gained,0);
 assert.deepEqual(c.observe(s,at(50100),6000),{outcome:'gain',change:100});
 for(let i=0;i<5;i++)assert.equal(c.observe(s,at(50100),7000+i*1000).outcome,'same');assert.equal(s.gained,100,'repeated frames do not add');assert.equal(s.readingsCount,2);}
// A misread appears in one frame only: no gain.
{const s=fresh();c.observe(s,{...at(99999),pct:at(50000).pct},5000);c.observe(s,at(50100),6000);assert.equal(s.gained,0);c.observe(s,at(50100),7000);assert.equal(s.gained,100);}
// A misread on two frames in a row breaks amount against percentage: refused.
{const s=fresh();twice(s,at(50100),2000);
 const bad={exp:59100,pct:at(50200).pct,hp:null,hpMax:null,mp:null,mpMax:null};
 c.observe(s,bad,5000);assert.equal(c.observe(s,bad,6000).outcome,'rejected');assert.equal(s.exp,50100,'the good value stands');assert.equal(s.gained,100);assert.equal(s.misreads,1);
 twice(s,at(50200),8000);assert.equal(s.gained,200,'tracking continues from the good value');}
// A disagreement that persists means the first reading was the misread: corrected, nothing counted across it.
{const s=c.createSession('a',0);const bad={exp:44732,pct:40.51};twice(s,bad,0);const good=at(49800);let last;for(let i=0;i<4;i++){c.observe(s,good,3000+i*2000);last=c.observe(s,good,4000+i*2000);if(last.outcome==='corrected')break;}
 assert.equal(last.outcome,'corrected');assert.equal(s.exp,49800);assert.equal(s.gained,0,'the correction is not a gain');}
// Level-up: the percentage wraps. The gain is the rest of the old level plus the new EXP, and the requirement starts over.
{const s=fresh(120000);s.level=32;const next={exp:300,pct:.2};twice(s,next,5000);
 assert.equal(s.levelUps,1);assert.equal(s.level,33);assert.ok(Math.abs(s.gained-(NEED-120000+300))<=20,'gain across the level '+s.gained);
 assert.equal(c.requirement(s)>100000,true);twice(s,{exp:400,pct:.27},9000);assert.equal(s.exp,400);}
// A level-up where the old requirement is unknown still counts what is known.
{const s=c.createSession('a',0);twice(s,{exp:0,pct:0},0);twice(s,{exp:5,pct:0},2000);assert.equal(s.exp,5);}
// Dying costs EXP: a loss, never a negative gain, and the requirement is unchanged.
{const s=fresh(60000);const r=c.requirement(s);assert.equal(twice(s,at(52000),3000).outcome,'loss');assert.equal(s.gained,0);assert.equal(s.lost,8000);assert.equal(s.levelUps,0);assert.equal(c.requirement(s)>=r-30,true);
 twice(s,at(52100),5000);assert.equal(s.gained,100,'the next gain counts from after the loss');}
// A temporary failure is not a gap in the sum: EXP gained while the bar was covered counts when it is readable again.
{const s=fresh();for(let i=0;i<20;i++)assert.equal(c.observe(s,{exp:null,pct:null,hp:null,hpMax:null,mp:null,mpMax:null},2000+i*1000).outcome,'unreadable');twice(s,at(50500),30000);assert.equal(s.gained,500);}
// Pause: nothing is counted, and the first reading after it is a new start.
{const s=fresh();c.pause(s,10000);assert.equal(c.observe(s,at(51000),11000).outcome,'paused');c.resume(s,70000);assert.equal(s.gained,0);
 twice(s,at(52000),71000);assert.equal(s.gained,0,'what changed during the pause is not a gain');twice(s,at(52100),73000);assert.equal(s.gained,100);
 assert.equal(c.activeMs(s,74000),14000,'paused time is not counted');}
// Rates.
{const s=fresh(10000,0);let exp=10000,t=2000;for(let i=0;i<6;i++){exp+=2000;twice(s,at(exp),t);t+=60000;}
 const f=c.stats(s,t);assert.equal(f.gained,12000);assert.ok(f.average>1900&&f.average<2100,'average '+f.average);assert.ok(f.lastMinute>0&&f.lastMinute<=4000);assert.equal(f.best,2000);
 assert.ok(Math.abs(f.need-NEED)<30);assert.ok(f.toLevel>0&&Math.abs(f.toLevel/6e4-(NEED-22000)/f.average)<3,'time to level '+f.toLevel);assert.ok(Math.abs(f.pctPerMin-1.63)<.2);}
// Too little time, or no gain: figures stay empty rather than invented.
{const s=fresh();const f=c.stats(s,5000);assert.equal(f.average,null);assert.equal(f.lastMinute,null);assert.equal(f.best,null);assert.equal(f.toLevel,null);
 const later=c.stats(s,6e5);assert.equal(later.average,0);assert.equal(later.toLevel,null,'no gain means no estimate');}
// Maps: each stay is a row of the history.
{const s=c.createSession('a',0);c.setMap(s,'Henesys',0);twice(s,at(50000),0);twice(s,at(50400),30000);c.setMap(s,'Pig Beach',60000);twice(s,at(51400),120000);
 c.setMap(s,'Pig Beach',121000);assert.equal(s.segments.length,2,'the same map is no new stay');
 const [a,b]=s.segments.map(g=>c.segmentRow(s,g,180000));assert.equal(a.gained,400);assert.equal(a.ms,60000);assert.equal(b.gained,1000);assert.equal(b.ms,120000);assert.equal(b.average,500);assert.equal(b.peak,1000);}
// Chart series: gaps are zero, the window applies, and 'map' follows the current map.
{const s=fresh(10000,0);c.setMap(s,'A',0);twice(s,at(11000),60000);twice(s,at(12000),240000);c.setMap(s,'B',300000);twice(s,at(13000),360000);
 const all=c.series(s,420000,'all');assert.deepEqual(all.map(m=>m.gained),[0,1000,0,0,1000,0,1000,0].slice(0,all.length));
 assert.equal(c.series(s,420000,3).length,3);assert.ok(c.series(s,420000,'map').every(m=>m.minute>=5));}
// Recoveries are inferred from HP/MP rising; a misread spike or natural regeneration is not one.
{const s=fresh();const v=(hp,mp=900)=>({exp:50000,pct:at(50000).pct,hp,hpMax:851,mp,mpMax:1621});
 c.observe(s,v(300),3000);c.observe(s,v(300),4000);c.observe(s,v(305),5000);c.observe(s,v(305),6000);assert.equal(s.recoveries,0,'small regeneration');
 c.observe(s,v(800),7000);assert.equal(s.recoveries,0,'one frame is not enough');c.observe(s,v(310),8000);assert.equal(s.recoveries,0,'a spike that does not repeat');
 c.observe(s,v(600),9000);c.observe(s,v(600),10000);assert.equal(s.recoveries,1,'a steady rise');
 c.observe(s,v(600,300),11000);c.observe(s,v(600,300),12000);c.observe(s,v(600,900),13000);c.observe(s,v(600,900),14000);assert.equal(s.recoveries,2,'MP too');}
// A level-up refills the gauges: not a recovery.
{const s=fresh(120000);c.observe(s,{...at(120000),hp:100},3000);c.observe(s,{...at(120000),hp:100},4000);const n={exp:300,pct:.2,hp:880,hpMax:880,mp:1650,mpMax:1650};c.observe(s,n,5000);c.observe(s,n,6000);c.observe(s,n,7000);assert.equal(s.recoveries,0);}
// Storage.
{const s=fresh();const kept=JSON.parse(JSON.stringify(c.archive(s)));assert.equal(kept.exp,50000);assert.equal('pending' in kept,false);c.end(s,9000);assert.equal(s.status,'ended');assert.equal(c.activeMs(s,99999),9000);assert.equal(c.formatDuration(3725000),'1h 02m');assert.equal(c.formatDuration(65000),'1m 05s');assert.equal(c.formatDuration(null),'—');}
{const s=c.createSession('a',0);for(let i=0;i<c.MAX_READINGS+50;i++){const e=1000+i*10;twice(s,at(e),i*2000);}assert.equal(s.readings.length,c.MAX_READINGS,'the log is bounded');assert.equal(s.readingsCount,c.MAX_READINGS+50);}

// Every route's stages are real maps of the game, and every quest is in the data.
const names=new Set(data.maps.map(m=>m.name));
for(const r of ROUTES){for(const [map] of r.stages)assert.ok(names.has(map),r.id+': '+map);assert.ok(data.quests.some(q=>q.id===r.quest),r.id+' quest');}
assert.equal(ROUTES.filter(r=>r.type==='PQ').length,1,'the game has one party quest');
assert.ok(!data.maps.some(m=>/Dev/.test(m.region)),'developer maps are left out');
assert.equal(data.source.license,'CC BY 4.0');assert.ok(data.source.changes);
// A map on two routes would make progress ambiguous.
{const seen=new Set();for(const r of ROUTES)for(const [m] of r.stages){assert.ok(!seen.has(m.toLowerCase()+(r.street||'')),m);seen.add(m.toLowerCase()+(r.street||''));}}

// Reading the map name.
const near=(t,s)=>closestMap(t,data.maps,s)?.name;
assert.equal(near('Henesys'),'Henesys');assert.equal(near('Henesvs'),'Henesys','one wrong letter');
assert.equal(near('The Forest of Patience <Step 1>'),'The Forest of Patience <Step 1>');
assert.equal(near('The Forest of Patience <Step'),'The Forest of Patience <Step 1>','cut off by the minimap');
assert.equal(near('The Deep Forest of Patience <Step 3>'),'The Deep Forest of Patience <Step 3>','not the shorter forest');
assert.equal(near('1st Accompaniment <Last Stage>'),'1st Accompaniment <Last Stage>');
assert.equal(near('Free Market <8>'),'Free Market <8>');
assert.equal(near('xqzvb'),undefined,'noise is no map');assert.equal(near(''),undefined);
assert.equal(closestMap('Shortcut',data.maps,'Hidden Street')?.street,'Hidden Street');

// A jump quest run.
{const log=createQuestLog();assert.deepEqual(observeMap(log,'Henesys',0),{});assert.equal(log.run,null);
 assert.equal(observeMap(log,'The Forest of Patience <Step 1>',1000).started.id,'sabitrama-flower');
 assert.equal(routeView(log,data,2000).stages[0].state,'current');assert.equal(routeView(log,data,2000).total,2);
 assert.equal(observeMap(log,'The Forest of Patience <Step 2>',61000).advanced,1);
 assert.equal(routeView(log,data,61000).stages[0].state,'done');
 const {ended}=observeMap(log,'Ellinia',181000);assert.equal(ended.finished,true);assert.equal(ended.ms,180000);assert.deepEqual(log.records['sabitrama-flower'],{attempts:1,finished:1,bestMs:180000});}
// Leaving early is an attempt, not a finish; a fall back a stage is counted; the best time is the fastest finish.
{const log=createQuestLog();observeMap(log,'B3 <Area 1>',0);observeMap(log,'B3 <Area 2>',1000);observeMap(log,'B3 <Area 1>',2000);assert.equal(log.run.falls,1);
 assert.equal(observeMap(log,'Kerning City',3000).ended.finished,false);assert.equal(log.records['shumi-b3'].bestMs,null);
 observeMap(log,'B3 <Area 1>',4000);for(const m of ['B3 <Area 2>','B3 <Area 3>','B3 <Subway Depot>'])observeMap(log,m,5000);observeMap(log,'Kerning City',10000);
 assert.deepEqual(log.records['shumi-b3'],{attempts:2,finished:1,bestMs:6000});}
// The party quest counts as finished at its last stage; hints come from the data.
{const log=createQuestLog();observeMap(log,'1st Accompaniment <1st Stage>',0);const v=routeView(log,data,1000);assert.equal(v.route.type,'PQ');assert.equal(v.total,7);assert.ok(v.stages[0].monsters.some(m=>/Ligator ×22/.test(m)));assert.ok(v.stages[0].people.includes('Cloto'));assert.equal(v.quest.level,21);
 observeMap(log,'1st Accompaniment <Last Stage>',2000);assert.ok(routeView(log,data,3000).stages[4].monsters.some(m=>/King Slime/.test(m)));assert.equal(observeMap(log,'Kerning City',4000).ended.finished,true);}
// Moving straight from one route to another closes the first.
{const log=createQuestLog();observeMap(log,'The Forest of Patience <Step 2>',0);const r=observeMap(log,'The Forest of Patience <Step 3>',1000);assert.ok(r.ended);assert.equal(r.started.id,'sabitrama-herb');}
{const saved=JSON.parse(JSON.stringify(createQuestLog()));assert.deepEqual(createQuestLog(saved).records,{});}
assert.equal(findStage('Henesys'),null);

console.log('Companion: confirmation, misread and level-up handling, deaths, pauses, rates, maps, recoveries, storage and quest runs passed; all routes are real maps.');
