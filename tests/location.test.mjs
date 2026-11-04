// Where to find a listing (dist/location.mjs): the structured location, publishing validation, manual corrections, drafts
// completed only by an agreeing location, the "Where to find" text and listing filters.
import assert from 'node:assert/strict';
import * as L from '../dist/location.mjs';

// ---- The model ----
const fm7=L.makeLocation({world:'Windia',channel:1,roomNumber:7,mapName:'ignored',shopName:'Trash',locationConfidence:87.6});
assert.deepEqual([fm7.locationType,fm7.roomNumber,fm7.mapName,fm7.locationSource,fm7.locationConfidence],['FM_ROOM',7,null,'AUTO',88]);
const hidden=L.makeLocation({world:'Windia',channel:2,mapName:'  Hidden   Street ',locationSource:'MANUAL'});
assert.deepEqual([hidden.locationType,hidden.roomNumber,hidden.mapName,hidden.locationSource],['NAMED_MAP',null,'Hidden Street','MANUAL']);
assert.equal(L.makeLocation({channel:41,roomNumber:100}).channel,null,'out-of-range channel is not kept');
assert.equal(L.makeLocation({channel:1,roomNumber:100}).locationType,null,'out-of-range room is not kept');

// ---- Publishing validation: nothing is filled in by default ----
assert.deepEqual(L.locationProblems(fm7,{needWorld:true}),[]);
assert.deepEqual(L.locationProblems(hidden),[]);
assert.match(L.locationProblems(L.makeLocation({world:'Windia',roomNumber:7})).join(' '),/Channel unknown/,'channel always required');
assert.match(L.locationProblems(L.makeLocation({world:'Windia',channel:1})).join(' '),/FM room or map unknown/,'room or map required');
assert.match(L.locationProblems(L.makeLocation({channel:1,roomNumber:7}),{needWorld:true}).join(' '),/World unknown/,'world required when several are supported');
assert.deepEqual(L.locationProblems(L.makeLocation({channel:1,roomNumber:7}),{needWorld:false}),[],'single-world sites need no world');
assert.match(L.locationProblems({...hidden,mapName:'Free Market <>'}).join(' '),/Map name unclear/,'an unread FM line is not a map name');
assert.match(L.locationProblems(L.makeLocation({channel:1,mapName:'ab'})).join(' '),/Map name unclear/,'too short a map name');
assert.equal(L.validLocation(null),false);

// ---- Drafts: completed only by a location that agrees with what was known when they were seen ----
const seenRoom7=L.makeLocation({world:'Windia',roomNumber:7});
assert.equal(L.compatible(seenRoom7,fm7),true,'room 7 seen, channel entered later');
assert.equal(L.compatible(seenRoom7,L.makeLocation({world:'Windia',channel:1,roomNumber:8})),false,'seen in room 7, not publishable in room 8');
assert.equal(L.compatible(seenRoom7,hidden),false,'FM room draft never becomes a named-map listing');
assert.equal(L.compatible(L.makeLocation({world:'Scania',channel:1,roomNumber:7}),fm7),false,'other world');
assert.equal(L.compatible(L.makeLocation({}),fm7),true,'nothing known: the player confirms the location');

// ---- Where to find ----
assert.equal(L.whereToFind(fm7),'CH 1 • FM Room 7');
assert.equal(L.whereToFind(hidden),'CH 2 • Hidden Street');
assert.equal(L.whereToFind({channel:1,location_type:'FM_ROOM',room:12,map:'Free Market 12'}),'CH 1 • FM Room 12','database rows');
assert.equal(L.whereToFind({channel:3,room:5,map_name:''}),'CH 3 • FM Room 5','player stores');
assert.equal(L.whereToFind({channel:2,room:null,map_name:'Hidden Street'}),'CH 2 • Hidden Street');
assert.equal(L.whereToFind({channel:4,map:'Free Market 9'}),'CH 4 • FM Room 9','older rows with only a map');
assert.equal(L.whereToFind({}),'');
assert.equal(L.locationText({world:'Windia',channel:35,room:8}),'Windia · Ch 35 · FM 8','Discord alerts keep their format');

// ---- Database columns and filters ----
assert.deepEqual(L.locationColumns(fm7),{channel:1,location_type:'FM_ROOM',room:7,map:'Free Market 7',location_source:'AUTO',location_confidence:88,seller_name:''});
assert.deepEqual(L.locationColumns(hidden),{channel:2,location_type:'NAMED_MAP',room:null,map:'Hidden Street',location_source:'MANUAL',location_confidence:null,seller_name:''});
const rows=[{channel:1,room:7,map:'Free Market 7'},{channel:2,room:null,map:'Hidden Street'},{channel:1,room:12,map:'Free Market 12'}];
assert.equal(rows.filter(r=>L.matchesFilter(r,{channel:'1'})).length,2);
assert.equal(rows.filter(r=>L.matchesFilter(r,{channel:'1',room:'7'})).length,1);
assert.equal(rows.filter(r=>L.matchesFilter(r,{map:'hidden'})).length,1);
assert.equal(rows.filter(r=>L.matchesFilter(r,{})).length,3);
console.log('Locations: model, missing-location rejection, manual sources, draft completion, Where to find text and filters passed.');
