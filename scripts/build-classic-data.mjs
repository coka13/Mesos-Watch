// Rebuilds dist/classic-data.json: the maps, monsters, jobs and quest facts the Companion uses, from the OSMS Data Explorer
// public dataset for MapleStory Classic World. Re-run after a game patch.
//   node scripts/build-classic-data.mjs                download, check each file against the dataset's meta.json, write
//   node scripts/build-classic-data.mjs --from <dir>   use files saved earlier
// The dataset is CC BY 4.0 (https://osmsdataexplorer.com/data/api/v1/LICENSE): the credit and a note of what was changed travel
// with the output and are shown on the Companion page. Game content is (c) Nexon and is not covered by that license.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE='https://osmsdataexplorer.com/data/api/v1/',FILES=['maps','monsters','npcs','quests','skills'];
const args=process.argv.slice(2),from=args[0]==='--from'?args[1]:null;
const fetchText=async name=>{
 if(from)return fs.readFileSync(path.join(from,name),'utf8');
 const r=await fetch(BASE+name);if(!r.ok)throw Error(name+': HTTP '+r.status);return r.text();
};
const meta=JSON.parse(await fetchText('meta.json'));
const raw=Object.fromEntries(await Promise.all(FILES.map(async f=>{
 const text=await fetchText(f+'.json'),want=meta.files?.[f+'.json']?.sha256,got=crypto.createHash('sha256').update(text).digest('hex');
 if(want&&want!==got)throw Error(f+'.json does not match meta.json: a partial download, or a newer build than meta.json');
 return[f,JSON.parse(text)];
})));

const npcName=new Map(raw.npcs.map(n=>[n.id,n.name]));
// Monster counts per map, from the monsters' own spawn lists.
const spawns=new Map();
for(const m of raw.monsters)for(const s of m.spawns||[]){const list=spawns.get(s.map_id)||[];list.push([m.id,s.count]);spawns.set(s.map_id,list);}
const usedMobs=new Set();
const maps=raw.maps.filter(m=>m.region!=='Dev').map(m=>{
 const mobs=(spawns.get(m.id)||[]).sort((a,b)=>a[0]-b[0]);for(const [id] of mobs)usedMobs.add(id);
 const npcs=[...new Set((m.npcs||[]).map(n=>npcName.get(n.npc_id)).filter(n=>n&&n!=='Exit'))];
 return{id:m.id,name:m.name,street:m.street_name||'',region:m.region,...(m.is_town?{town:true}:{}),...(mobs.length?{mobs}:{}),...(npcs.length?{npcs}:{})};
});
const monsters=raw.monsters.filter(m=>usedMobs.has(m.id)).map(m=>({id:m.id,name:m.name,level:m.level,hp:m.hp,exp:m.exp,...(m.is_boss?{boss:true}:{}),...(m.icon_url?{icon:m.icon_url}:{})}));
const jobs=[...new Set(raw.skills.filter(s=>s.job_id<1000).map(s=>s.class_name).filter(Boolean))];
// The quests behind the Companion's routes: name, level and rewards, by quest id.
const QUESTS=[10311,10312,10313,10314,10509,10510,10006,10007,10008];
const quests=QUESTS.map(id=>{
 const q=raw.quests.find(x=>x.id===id);if(!q)throw Error('Quest '+id+' is gone from the dataset: review dist/companion-quests.mjs');
 const reward=type=>(q.rewards||[]).find(r=>r.type===type)?.value??null;
 return{id,name:q.name,level:q.level_min??null,npc:npcName.get(q.npc_id)||'',exp:reward('exp'),mesos:reward('money')};
});

const out={
 source:{name:'OSMS Data Explorer',url:'https://osmsdataexplorer.com',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
  changes:'Reduced to the fields Mesos-Watch uses; monster spawns grouped by map.',game:meta.game,clientBuild:meta.client_build,updatedAt:meta.data_updated_at},
 jobs,maps,monsters,quests,
};
const file=new URL('../dist/classic-data.json',import.meta.url);
fs.writeFileSync(file,JSON.stringify(out));
console.log(`classic-data.json: ${maps.length} maps, ${monsters.length} monsters, ${jobs.length} jobs, ${quests.length} quests, ${fs.statSync(file).size} bytes, data of ${meta.data_updated_at}`);
