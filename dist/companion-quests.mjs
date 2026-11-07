// Party Quest and Jump Quest progress, followed from the map name alone. Pure: no DOM, no clock.
// Routes use the map names of the game's own data (classic-data.json). Hints state only what that data shows: who is on a stage,
// which monsters spawn there, what the route ends at. Puzzle solutions are not in the data, so none are claimed here.
import {editDistance} from './hud.mjs?v=1';

export const WIKI='https://classic.maplestorywiki.net/w/';
const steps=(prefix,from,to)=>Array.from({length:to-from+1},(_,i)=>`${prefix} <Step ${from+i}>`);
const FOREST='The Forest of Patience',DEEP='The Deep Forest of Patience',SITE='Line 3 Construction Site';
export const ROUTES=[
 {id:'first-time-together',type:'PQ',name:'First Time Together',quest:10311,start:'Lakelis, Kerning City',party:'Party of 4, level 21+',guide:'First_Time_Together',
  goal:'Defeat King Slime on the last stage.',
  stages:[['1st Accompaniment <1st Stage>','Stage 1'],['1st Accompaniment <2nd Stage>','Stage 2'],['1st Accompaniment <3rd Stage>','Stage 3'],['1st Accompaniment <4th stage>','Stage 4'],['1st Accompaniment <Last Stage>','Last stage'],['1st Accompaniment <Bonus>','Bonus'],['1st Accompaniment <Exit>','Exit']],
  goalStage:4},
 {id:'sabitrama-flower',type:'JQ',name:'Sabitrama and the Diet Medicine',quest:10509,start:'Sabitrama, Sleepywood. Shane in Ellinia takes you there.',guide:null,
  goal:'Reach the pile of flowers for the Pink Anthurium.',stages:steps(FOREST,1,2).map((m,i)=>[m,'Step '+(i+1)])},
 {id:'sabitrama-herb',type:'JQ',name:'Sabitrama’s Anti-Aging Medicine',quest:10510,start:'Sabitrama, Sleepywood. Shane in Ellinia takes you there.',guide:null,
  goal:'Reach the pile of herbs for the Double-Rooted Red Ginseng.',stages:steps(FOREST,3,5).map((m,i)=>[m,'Step '+(i+3)])},
 ...[['b1','B1','Shumi’s Lost Coin',10312,['Area 1','Area 2','Subway Depot']],['b2','B2','Shumi’s Lost Roll of Cash',10313,['Area 1','Area 2','Subway Depot']],['b3','B3','Shumi’s Lost Sack of Cash',10314,['Area 1','Area 2','Area 3','Subway Depot']]].map(([id,floor,name,quest,areas])=>
  ({id:'shumi-'+id,type:'JQ',name,quest,start:'Shumi, Kerning City',guide:null,street:SITE,goal:'Reach the Treasure Chest at the Subway Depot.',stages:areas.map(a=>[`${floor} <${a}>`,`${floor} ${a}`])})),
 {id:'john-pink',type:'JQ',name:'John’s Pink Flower Basket',quest:10006,start:'John, Lith Harbor. The Mysterious Statue in Sleepywood takes you there.',guide:null,
  goal:'Reach the pile of pink flowers: John asks for 10 Pink Violas.',stages:steps(DEEP,1,2).map((m,i)=>[m,'Step '+(i+1)])},
 {id:'john-blue',type:'JQ',name:'John’s Present',quest:10007,start:'John, Lith Harbor. The Mysterious Statue in Sleepywood takes you there.',guide:null,
  goal:'Reach the pile of blue flowers: John asks for 20 Blue Violas.',stages:steps(DEEP,3,4).map((m,i)=>[m,'Step '+(i+3)])},
 {id:'john-white',type:'JQ',name:'John’s Last Present',quest:10008,start:'John, Lith Harbor. The Mysterious Statue in Sleepywood takes you there.',guide:null,
  goal:'Reach the pile of white flowers: John asks for 30 White Violas.',stages:steps(DEEP,5,7).map((m,i)=>[m,'Step '+(i+5)])},
];
const key=t=>String(t||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const stageIndex=new Map(ROUTES.flatMap(route=>route.stages.map(([map],index)=>[key(map),{route,index}])));
export const findStage=mapName=>stageIndex.get(key(mapName))||null;

// A read of the minimap's map line, snapped to the game's map names. The list is closed, so OCR noise can be corrected, and a long
// name that lost its start or end still matches on what is left. Two different names fitting equally well is no reading: "Patience
// <Step 1>" could be either forest, and quest progress must not guess. Too far from every name is no reading either.
// Characters OCR swaps in the game's small font are folded on both sides, so "81 <Area 2>" still finds B1.
const fold=s=>key(s).replaceAll('8','b').replaceAll('0','o').replaceAll('5','s').replace(/[il|]/g,'1');
export function closestMap(text,names,street=''){
 const t=fold(text);if(t.length<3)return null;
 const streetKey=key(street);let best=null,dist=Infinity,tied=false;
 for(const m of names){
  const n=fold(m.name),short=t.length<n.length,d=Math.min(editDistance(t,n),short?editDistance(t,n.slice(0,t.length))+1:Infinity,short?editDistance(t,n.slice(-t.length))+1:Infinity);
  // Five names repeat on different streets: the street line settles those.
  const score=d-(streetKey&&editDistance(streetKey,key(m.street))<=2?.5:0);
  if(score<dist){dist=score;best=m;tied=false;}else if(score===dist&&n!==fold(best.name))tied=true;
 }
 return best&&!tied&&Math.ceil(dist)<=Math.max(1,Math.floor(t.length/5))?best:null;
}

export function createQuestLog(saved){return{run:null,records:saved?.records||{},recent:saved?.recent||[]};}
function close(log,now,finished){
 const run=log.run;log.run=null;
 const ms=now-run.startedAt,rec=log.records[run.routeId]??={attempts:0,finished:0,bestMs:null};
 rec.attempts++;if(finished){rec.finished++;rec.bestMs=rec.bestMs===null?ms:Math.min(rec.bestMs,ms);}
 const entry={routeId:run.routeId,startedAt:run.startedAt,ms,finished,reached:run.reached,falls:run.falls};
 log.recent=[entry,...log.recent].slice(0,20);
 return entry;
}
const reachedGoal=(route,run)=>run.reached>=(route.goalStage??route.stages.length-1);
// The map changed. Returns {started,advanced,ended} as they happened.
export function observeMap(log,mapName,now){
 const hit=findStage(mapName),out={};
 if(log.run){
  const route=ROUTES.find(r=>r.id===log.run.routeId);
  if(hit?.route===route){
   if(hit.index!==log.run.stage){
    if(hit.index<log.run.stage)log.run.falls++;
    log.run.splits.push({stage:hit.index,at:now});log.run.stage=hit.index;log.run.reached=Math.max(log.run.reached,hit.index);out.advanced=hit.index;
   }
   return out;
  }
  out.ended=close(log,now,reachedGoal(route,log.run));
 }
 if(hit){log.run={routeId:hit.route.id,startedAt:now,stage:hit.index,reached:hit.index,falls:0,splits:[{stage:hit.index,at:now}]};out.started=hit.route;}
 return out;
}
// The route on screen: each stage with its state, and what the data says about it. `maps` and `monsters` come from classic-data.json.
export function routeView(log,data,now){
 if(!log.run)return null;
 const route=ROUTES.find(r=>r.id===log.run.routeId),byName=new Map(data.maps.map(m=>[key(m.name),m])),mob=new Map(data.monsters.map(m=>[m.id,m])),quest=data.quests.find(q=>q.id===route.quest);
 const stages=route.stages.map(([map,label],i)=>{
  const m=byName.get(key(map)),split=[...log.run.splits].reverse().find(s=>s.stage===i);
  const monsters=(m?.mobs||[]).map(([id,n])=>`${mob.get(id)?.name||'Monster'} ×${n}`),people=(m?.npcs||[]).filter(n=>!/^Louis$|Crumbling Statue/.test(n));
  return{label,map,state:i===log.run.stage?'current':i<=log.run.reached?'done':'next',monsters,people,enteredAt:split?.at??null};
 });
 return{route,quest,stages,index:log.run.stage,total:route.stages.length,elapsed:now-log.run.startedAt,falls:log.run.falls,record:log.records[route.id]||null};
}
