import {client} from './api.mjs?v=depth-1';
export async function result(query){const {data,error}=await query;if(error)throw Error(/42P01|42883|PGRST20[25]/.test(error.code||'')?'This feature needs the platform database migrations.':error.message);return data;}
export async function account(){const sb=await client();const {data,error}=await sb.auth.getUser();if(error&&!/session missing/i.test(error.message))throw Error(error.message);return data.user?.email?data.user:null;}
// The emailed link returns to the bare page (Supabase puts the login in the URL fragment), so the page to come back to is kept locally.
const BACK='mw-signin-back';
export async function signIn(email){const sb=await client();const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});if(error)throw Error(error.message);localStorage.setItem(BACK,location.hash||'#stores');}
client().then(sb=>sb.auth.onAuthStateChange((event,s)=>{if(event!=='SIGNED_IN'||!s?.user?.email)return;document.querySelectorAll('.sign-in-box').forEach(b=>b.remove());const back=localStorage.getItem(BACK);localStorage.removeItem(BACK);setTimeout(()=>{if(back&&back!==location.hash)location.hash=back;else window.dispatchEvent(new HashChangeEvent('hashchange'));},0);})).catch(()=>{});
// Account features call this: signed-in visitors get their user; everyone else gets an email sign-in box right where they are.
export class SignInNeeded extends Error{}
export async function needAccount(anchor,why){
 const user=await account();if(user)return user;
 const view=document.querySelector('.view:not([hidden])'),after=anchor||view?.querySelector('.page-head'),host=after?after.parentElement:view;
 if(!host)throw Error(why||'Sign in to use this feature.');
 if(!host.querySelector(':scope>.sign-in-box')){
  const box=document.createElement('form');box.className='sign-in-box';
  const text=document.createElement('p');text.textContent=(why||'Sign in to use this feature.')+' We’ll email you a sign-in link, no password needed.';
  const label=document.createElement('label');label.textContent='Email';const input=Object.assign(document.createElement('input'),{type:'email',required:true,autocomplete:'email'});label.append(input);
  const send=Object.assign(document.createElement('button'),{textContent:'Send sign-in link'}),status=Object.assign(document.createElement('p'),{className:'status'});status.setAttribute('role','status');
  box.append(text,label,send,status);
  box.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{await signIn(input.value.trim());status.className='status';status.textContent='Check your email ('+input.value.trim()+') and open the link in this browser. It brings you back here, signed in.';}catch(err){status.className='status error';status.textContent=err.message;}finally{send.disabled=false;}};
  if(after)after.after(box);else host.prepend(box);
  input.focus({preventScroll:true});
 }
 throw new SignInNeeded('');
}
export async function ownStores(){const user=await account();if(!user)return[];return result((await client()).from('player_stores').select('*').eq('owner',user.id).order('updated_at',{ascending:false}));}
export const publicStores=async world=>{let q=(await client()).from('public_player_stores').select('*');if(world)q=q.eq('world',world);return result(q.order('updated_at',{ascending:false}).limit(50));};
export const storeListings=async(id,own=false)=>result((await client()).from(own?'player_listings':'public_player_listings').select('*').eq('store_id',id).order('updated_at',{ascending:false}).limit(200));
export async function saveStore(id,patch){const sb=await client();return result((id?sb.from('player_stores').update(patch).eq('id',id):sb.from('player_stores').insert(patch)).select().single());}
export const removeStore=async id=>result((await client()).from('player_stores').delete().eq('id',id));
export async function saveListing(id,patch){const sb=await client();return result((id?sb.from('player_listings').update(patch).eq('id',id):sb.from('player_listings').insert(patch)).select().single());}
export const removeListing=async id=>result((await client()).from('player_listings').delete().eq('id',id));
export const opportunities=async world=>result((await client()).rpc('market_opportunities',{p_world:world}));
