// Training sessions from status-bar readings: EXP gained, rates, level-ups, maps and recoveries. Pure: no DOM and no clock, so every
// rule can be tested; each call is given the time. Sessions stay in this browser and are never uploaded.
// A reading only counts when it survives three checks, because one misread digit would otherwise read as a huge gain:
//  1. It repeats on the next frame.
//  2. Amount and percentage imply the EXP this level needs (amount / percentage). That figure is constant within a level, so a
//     reading that disagrees with the session's is a misread. Only a disagreement that persists is believed.
//  3. EXP falling a little is a death, never a negative gain. Falling a lot is a level-up.
const MINUTE=6e4;
export const CONFIRM_FRAMES=2,TRUST_AFTER=3,LEVEL_UP_DROP=12,RECENT_MS=10*MINUTE,MAX_READINGS=300,MAX_MINUTES=720;
// Recoveries: HP or MP rising by this much between two steady readings. Potions and healing skills look the same here.
export const RECOVERY_SHARE=.05,RECOVERY_MIN=20;

export function createSession(id,now){
 return{id,startedAt:now,endedAt:null,status:'running',pausedMs:0,pausedAt:null,level:null,job:null,name:null,exp:null,pct:null,range:null,
  gained:0,lost:0,levelUps:0,readingsCount:0,recoveries:0,misreads:0,readings:[],minutes:[],segments:[],map:null,pending:null,conflict:null,vital:null,recent:[]};
}
const percentSlack=.011;                                    // the game may round or cut the percentage: accept either
export function requirementRange({exp,pct}){
 if(!(pct>0))return null;
 return{lo:exp*100/(pct+percentSlack),hi:exp*100/Math.max(pct-percentSlack,.001)};
}
const overlap=(a,b)=>a.lo<=b.hi&&b.lo<=a.hi;
const narrowed=(a,b)=>({lo:Math.max(a.lo,b.lo),hi:Math.min(a.hi,b.hi)});
export const requirement=s=>s.range?(s.range.lo+s.range.hi)/2:null;
export const activeMs=(s,now)=>Math.max(0,(s.endedAt??(s.pausedAt??now))-s.startedAt-s.pausedMs);

function addGain(s,amount,now){
 const m=Math.floor(activeMs(s,now)/MINUTE),last=s.minutes.at(-1);
 if(last&&last[0]===m)last[1]+=amount;else{s.minutes.push([m,amount]);if(s.minutes.length>MAX_MINUTES)s.minutes.shift();}
 s.gained+=amount;s.recent.push([now,amount]);
 const seg=s.segments.at(-1);
 if(seg){seg.gained+=amount;const k=seg.minutes.at(-1);if(k&&k[0]===m)k[1]+=amount;else seg.minutes.push([m,amount]);seg.peak=Math.max(seg.peak,seg.minutes.at(-1)[1]);}
}
function log(s,r,change,now,kind){
 s.readingsCount++;
 s.readings.push({t:now,level:s.level,exp:r.exp,change,pct:r.pct,map:s.map,kind});
 if(s.readings.length>MAX_READINGS)s.readings.shift();
}
function setBaseline(s,r){s.exp=r.exp;s.pct=r.pct;}

function trackVitals(s,r){
 for(const [cur,max,key] of [[r.hp,r.hpMax,'hp'],[r.mp,r.mpMax,'mp']]){
  if(cur===null||cur===undefined||!max)continue;
  const v=(s.vital??={})[key],need=Math.max(RECOVERY_MIN,max*RECOVERY_SHARE);
  // Counted once the higher value repeats, so a misread is not a recovery. A level-up refills the gauges and raises the maximum.
  if(v&&v.max===max&&v.pending!==null&&v.pending===cur&&cur-v.steady>=need){s.recoveries++;const seg=s.segments.at(-1);if(seg)seg.recoveries++;v.steady=cur;}
  if(!v||v.max!==max)s.vital[key]={steady:cur,pending:null,max};
  else if(cur<=v.steady){v.steady=cur;v.pending=null;}
  else v.pending=cur;
 }
}

// One frame's reading ({exp,pct,hp,hpMax,mp,mpMax}, null fields when unreadable). Returns what became of it.
export function observe(s,r,now){
 if(s.status!=='running')return{outcome:'paused'};
 trackVitals(s,r);
 if(r.exp===null||r.exp===undefined)return{outcome:'unreadable'};
 const key=r.exp+'|'+r.pct;
 if(s.exp===r.exp&&s.pct===r.pct){s.pending=null;return{outcome:'same'};}
 if(s.pending?.key!==key){s.pending={key,n:1};return{outcome:'waiting'};}
 if(++s.pending.n<CONFIRM_FRAMES)return{outcome:'waiting'};
 s.pending=null;
 const mine=requirementRange(r);
 if(s.exp===null){s.range=mine;setBaseline(s,r);s.conflict=null;log(s,r,0,now,'start');return{outcome:'baseline'};}
 const dropped=s.pct-r.pct;
 if(r.exp<s.exp&&dropped>=LEVEL_UP_DROP){
  const need=requirement(s)??(s.pct>=1?s.exp*100/s.pct:null),change=(need?Math.max(0,Math.round(need-s.exp)):0)+r.exp;
  addGain(s,change,now);s.levelUps++;if(s.level)s.level++;s.range=mine;s.conflict=null;setBaseline(s,r);log(s,r,change,now,'level');s.vital=null;
  return{outcome:'level-up',change};
 }
 if(s.range&&mine&&!overlap(s.range,mine)){
  // Believed only if it persists: then the earlier figure was the misread, and nothing is counted across the correction.
  s.misreads++;
  if(s.conflict?.key!==key)s.conflict={key,n:1};else s.conflict.n++;
  if(s.conflict.n<TRUST_AFTER)return{outcome:'rejected'};
  s.range=mine;s.conflict=null;setBaseline(s,r);log(s,r,0,now,'corrected');return{outcome:'corrected'};
 }
 s.conflict=null;
 if(mine)s.range=s.range?narrowed(s.range,mine):mine;
 const change=r.exp-s.exp;setBaseline(s,r);
 if(change>0){addGain(s,change,now);log(s,r,change,now,'gain');return{outcome:'gain',change};}
 s.lost-=change;log(s,r,change,now,'loss');return{outcome:'loss',change};
}

// Maps: every stay is a segment of the training history.
export function setMap(s,name,now){
 if(!name||s.map===name)return;
 const last=s.segments.at(-1);if(last)last.leftAt=activeMs(s,now);
 s.map=name;s.segments.push({map:name,arrivedAt:now,enteredAt:activeMs(s,now),leftAt:null,gained:0,peak:0,recoveries:0,minutes:[]});
}
// Paused time, and time without a shared window, is not counted. What changed meanwhile is not a gain: the next reading is a new start.
export function pause(s,now){if(s.status!=='running')return;s.status='paused';s.pausedAt=now;s.pending=null;}
export function resume(s,now){
 if(s.status!=='paused')return;
 s.pausedMs+=now-s.pausedAt;s.pausedAt=null;s.status='running';s.exp=null;s.pct=null;s.pending=null;s.conflict=null;s.vital=null;
}
export function end(s,now){
 if(s.status==='ended')return;
 if(s.pausedAt!==null){s.pausedMs+=now-s.pausedAt;s.pausedAt=null;}
 s.status='ended';s.endedAt=now;const last=s.segments.at(-1);if(last)last.leftAt=activeMs(s,now);
}
export function identify(s,{level,job,name}={}){if(level)s.level=level;if(job)s.job=job;if(name)s.name=name;}

// ---- Figures ----
const recentGain=(s,since)=>{let n=0;for(let i=s.recent.length-1;i>=0&&s.recent[i][0]>=since;i--)n+=s.recent[i][1];return n;};
const prune=(s,now)=>{const cut=now-RECENT_MS;while(s.recent.length&&s.recent[0][0]<cut)s.recent.shift();};
export function stats(s,now){
 prune(s,now);
 const active=activeMs(s,now),minutes=active/MINUTE,complete=Math.floor(minutes),need=requirement(s);
 const finished=s.minutes.filter(([m])=>m<complete).map(([,v])=>v);
 const average=minutes>=.5?s.gained/minutes:null,span=Math.min(minutes,RECENT_MS/MINUTE),recent=span>=.5?recentGain(s,now-RECENT_MS)/span:null;
 const left=need&&s.exp!==null?Math.max(0,need-s.exp):null,toLevel=left!==null&&recent>0?left/recent*MINUTE:null;
 return{active,gained:s.gained,lost:s.lost,lastMinute:minutes>=1?recentGain(s,now-MINUTE):null,average,best:finished.length?Math.max(...finished):null,
  need,left,toLevel,pctPerMin:average!==null&&need?average/need*100:null,levelUps:s.levelUps,recoveries:s.recoveries};
}
// Per-minute EXP for the chart, gaps filled with zero. window: 'map', a number of minutes, or 'all'.
export function series(s,now,window='all'){
 const end=Math.floor(activeMs(s,now)/MINUTE),seg=s.segments.at(-1),start=window==='map'?Math.floor((seg?.enteredAt??0)/MINUTE):window==='all'?Math.max(0,end-MAX_MINUTES+1):Math.max(0,end-window+1);
 const by=new Map(s.minutes),out=[];
 for(let m=start;m<=end;m++)out.push({minute:m,gained:by.get(m)||0});
 return out;
}
// One row of the training history. A map you are still on counts up to now.
export function segmentRow(s,seg,now){
 const until=seg.leftAt??activeMs(s,now),ms=Math.max(0,until-seg.enteredAt),minutes=ms/MINUTE;
 return{map:seg.map,arrivedAt:seg.arrivedAt,ms,gained:seg.gained,average:minutes>=.5?seg.gained/minutes:null,peak:seg.peak||null,recoveries:seg.recoveries};
}
// One row of the sessions table.
export function sessionRow(s,now){
 const f=stats(s,now);
 return{id:s.id,startedAt:s.startedAt,ms:f.active,gained:s.gained,perMin:f.average,pctPerMin:f.pctPerMin,readings:s.readingsCount,levelUps:s.levelUps,job:s.job,level:s.level};
}
// What a stored session keeps: the working fields of a live one are not worth keeping.
export function archive(s){const {pending,conflict,vital,...rest}=s;return{...rest,recent:[],readings:rest.readings.slice(-MAX_READINGS)};}
export function formatDuration(ms){
 if(ms===null||ms===undefined||!Number.isFinite(ms))return'—';
 const t=Math.max(0,Math.round(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;
 return h?`${h}h ${String(m).padStart(2,'0')}m`:m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}
