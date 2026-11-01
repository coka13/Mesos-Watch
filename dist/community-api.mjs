import {client} from './api.mjs?v=ms-2';
export async function result(query){const {data,error}=await query;if(error)throw Error(/42P01|42883|PGRST20[25]/.test(error.code||'')?'This feature needs the platform database migrations.':error.message);return data;}
export async function account(){const sb=await client();const {data,error}=await sb.auth.getUser();if(error&&!/session missing/i.test(error.message))throw Error(error.message);return data.user?.email?data.user:null;}
export async function signIn(email){const sb=await client();const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname+'#stores'}});if(error)throw Error(error.message);}
export async function ownStores(){const user=await account();if(!user)return[];return result((await client()).from('player_stores').select('*').eq('owner',user.id).order('updated_at',{ascending:false}));}
export const publicStores=async world=>{let q=(await client()).from('public_player_stores').select('*');if(world)q=q.eq('world',world);return result(q.order('updated_at',{ascending:false}).limit(50));};
export const storeListings=async(id,own=false)=>result((await client()).from(own?'player_listings':'public_player_listings').select('*').eq('store_id',id).order('updated_at',{ascending:false}).limit(200));
export async function saveStore(id,patch){const sb=await client();return result((id?sb.from('player_stores').update(patch).eq('id',id):sb.from('player_stores').insert(patch)).select().single());}
export const removeStore=async id=>result((await client()).from('player_stores').delete().eq('id',id));
export async function saveListing(id,patch){const sb=await client();return result((id?sb.from('player_listings').update(patch).eq('id',id):sb.from('player_listings').insert(patch)).select().single());}
export const removeListing=async id=>result((await client()).from('player_listings').delete().eq('id',id));
export const opportunities=async world=>result((await client()).rpc('market_opportunities',{p_world:world}));
