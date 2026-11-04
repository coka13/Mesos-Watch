// Where to find a listing: the structured location every published FM listing carries, its validation, and how it is shown.
//   {world, channel, locationType:'FM_ROOM'|'NAMED_MAP', roomNumber, mapName, shopName, sellerName,
//    locationSource:'AUTO'|'MANUAL', locationConfidence}
// Nothing here guesses: a missing channel, room or map name stays missing and blocks publishing.
export const FM_ROOM='FM_ROOM',NAMED_MAP='NAMED_MAP';
const int=v=>{const n=Number(v);return Number.isInteger(n)?n:null;};
export const validChannel=c=>int(c)!==null&&c>=1&&c<=40;
export const validRoom=r=>int(r)!==null&&r>=1&&r<=99;
export const cleanMapName=t=>String(t||'').replace(/[^A-Za-z0-9 :'().\-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,40);
// A map name that is really the FM ("Free Market <8>" with an unread number) is not a named map.
export const looksLikeFm=t=>/fr[e3]{2}\s*mar|market\s*[<({[]/i.test(String(t||''));

export function makeLocation({world='',channel=null,roomNumber=null,mapName='',shopName='',sellerName='',locationSource='AUTO',locationConfidence=null}={}){
 const room=validRoom(+roomNumber)?+roomNumber:null,map=room?'':cleanMapName(mapName);
 return{world:String(world||'').trim(),channel:validChannel(+channel)?+channel:null,locationType:room?FM_ROOM:map?NAMED_MAP:null,roomNumber:room,mapName:map||null,
  shopName:String(shopName||'').trim().slice(0,40),sellerName:String(sellerName||'').trim().slice(0,40),locationSource:locationSource==='MANUAL'?'MANUAL':'AUTO',
  locationConfidence:Number.isFinite(locationConfidence)?Math.max(0,Math.min(100,Math.round(locationConfidence))):null};
}
// Reasons a location cannot be published, in the order the player should fix them; empty when it is complete.
export function locationProblems(loc,{needWorld=false,needChannel=true}={}){
 const out=[];if(!loc)return['No location.'];
 if(needWorld&&!loc.world)out.push('World unknown: pick your world.');
 if(needChannel&&!validChannel(loc.channel))out.push('Channel unknown: open the Change Channel menu once, or enter the channel.');
 if(loc.locationType===FM_ROOM){if(!validRoom(loc.roomNumber))out.push('FM room unknown.');}
 else if(loc.locationType===NAMED_MAP){if(cleanMapName(loc.mapName).length<3||looksLikeFm(loc.mapName))out.push('Map name unclear: enter it.');}
 else out.push('FM room or map unknown: expand the minimap in the top-left corner, or enter the room or map.');
 return out;
}
export const validLocation=(loc,opts)=>locationProblems(loc,opts).length===0;
// Same place: a draft seen with part of a location may only be completed by a location that agrees on what it had.
export function compatible(partial,full){
 if(partial.world&&full.world&&partial.world.toLowerCase()!==full.world.toLowerCase())return false;
 if(partial.channel&&partial.channel!==full.channel)return false;
 if(partial.locationType&&partial.locationType!==full.locationType)return false;
 if(partial.roomNumber&&partial.roomNumber!==full.roomNumber)return false;
 if(partial.mapName&&full.mapName&&partial.mapName.toLowerCase()!==full.mapName.toLowerCase())return false;
 return true;
}
// "CH 1 • FM Room 7", "CH 2 • Hidden Street". Accepts the model or database rows (channel, room, map / map_name, location_type).
export function whereToFind(x){
 if(!x)return'';
 const room=x.roomNumber??x.room??null,type=x.locationType??x.location_type??(room?FM_ROOM:''),map=x.mapName??x.map_name??x.map??'';
 const place=room&&type!==NAMED_MAP?'FM Room '+room:map?map.replace(/^Free Market (\d+)$/,'FM Room $1'):'';
 return[x.channel?'CH '+x.channel:'',place].filter(Boolean).join(' • ');
}
// The compact form used in Discord alerts and status lines: "Windia · Ch 35 · FM 8" (or the map name).
export const locationText=loc=>loc?[loc.world,loc.channel?'Ch '+loc.channel:'',(loc.room??loc.roomNumber)?'FM '+(loc.room??loc.roomNumber):loc.mapName||''].filter(Boolean).join(' · '):'';
// Database columns for an observation or sold sighting.
export const locationColumns=loc=>({channel:loc.channel,location_type:loc.locationType,room:loc.roomNumber,map:loc.locationType===FM_ROOM?'Free Market '+loc.roomNumber:loc.mapName||'',
 location_source:loc.locationSource,location_confidence:loc.locationConfidence,seller_name:loc.sellerName||''});
// Client-side filter over listings: channel, FM room, map name (any may be empty).
export function matchesFilter(row,{channel='',room='',map=''}={}){
 if(channel&&+row.channel!==+channel)return false;
 if(room&&+(row.room??row.roomNumber)!==+room)return false;
 if(map&&!String(row.map_name??row.map??row.mapName??'').toLowerCase().includes(String(map).toLowerCase()))return false;
 return true;
}
