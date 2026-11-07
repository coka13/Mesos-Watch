// A stand-in for Supabase's HTTP layer in end-to-end tests. Every request runs against PGlite with all migrations applied, as the anon or
// authenticated role with the caller's id, so row-level security, grants, triggers and SQL functions are the real ones.
// Only PostgREST's request syntax and the auth endpoints are translated here, and only the parts the site uses.
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

export const HOST='https://e2e.supabase.co';
const EMBED={item:{table:'items',key:'item_id'},watch:{table:'watchlist',key:'watch_id'}};
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('bad identifier '+s);return '"'+s+'"';};

export async function createMock(){
 const db=new PGlite({extensions:{pg_trgm}});
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt() to anon,authenticated;`);
 for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 let queue=Promise.resolve();
 const serial=fn=>{const run=queue.then(fn,fn);queue=run.catch(()=>{});return run;};
 const users=new Map();let failing=null,seen=[];
 const tokenFor=u=>'e2e.'+Buffer.from(JSON.stringify({sub:u.id,exp:Math.floor(Date.now()/1000)+3600,email:u.email||'',role:'authenticated',is_anonymous:!u.email})).toString('base64url')+'.sig';
 const authUser=u=>({id:u.id,aud:'authenticated',role:'authenticated',email:u.email||'',is_anonymous:!u.email,app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});
 const session=u=>({access_token:tokenFor(u),refresh_token:'r-'+u.id,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:authUser(u)});
 async function addUser(email=null){
  const u={id:crypto.randomUUID(),email};users.set(u.id,u);
  await serial(()=>db.query(`insert into auth.users(id,email,is_anonymous) values($1,$2,$3)`,[u.id,email,!email]));
  return u;
 }
 const who=req=>{const t=(req.headers()['authorization']||'').replace('Bearer ','').split('.')[1];if(!t||t==='anon')return null;try{return JSON.parse(Buffer.from(t,'base64url').toString()).sub;}catch{return null;}};
 const as=async(uid,fn)=>serial(async()=>{
  await db.exec(`set role ${uid?'authenticated':'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[uid||'',uid?JSON.stringify({sub:uid,email:users.get(uid)?.email||'',is_anonymous:!users.get(uid)?.email}):'{}']);
  try{return await fn();}finally{await db.exec('reset role');}
 });
 // Filters: col=eq.x, in.(a,b), is.null, gte., or=(a.eq.x,b.eq.y).
 function clause(col,expr,args){
  const dot=expr.indexOf('.'),op=expr.slice(0,dot),val=expr.slice(dot+1),c=ident(col);
  if(op==='is')return `${c} is ${val==='null'?'null':val}`;
  if(op==='in'){const list=val.replace(/^\(|\)$/g,'').split(',').map(v=>v.replace(/^"|"$/g,''));return `${c}::text = any($${args.push(list)})`;}
  const sql={eq:'=',neq:'<>',gte:'>=',gt:'>',lte:'<=',lt:'<'}[op];if(!sql)throw Error('filter '+op);
  return `${c}::text ${sql==='='||sql==='<>'?sql:sql} $${args.push(val.replace(/^"|"$/g,''))}`.replace(/::text (>=|>|<=|<) (\$\d+)/,' $1 $2::text::timestamptz');
 }
 function where(params,args){
  const parts=[];
  for(const [k,v] of params){
   if(['select','order','limit','offset','on_conflict','columns'].includes(k))continue;
   if(k==='or'){const terms=v.replace(/^\(|\)$/g,'').match(/[^,"]+(?:"[^"]*")?[^,]*/g).map(t=>{const d=t.indexOf('.');return clause(t.slice(0,d),t.slice(d+1),args);});parts.push('('+terms.join(' or ')+')');continue;}
   parts.push(clause(k,v,args));
  }
  return parts.length?' where '+parts.join(' and '):'';
 }
 const order=v=>v?' order by '+v.split(',').map(t=>{const [c,d,n]=t.split('.');return ident(c)+(d==='desc'?' desc':' asc')+(n==='nullsfirst'?' nulls first':n==='nullslast'?' nulls last':'');}).join(','):'';
 // select=id,name,item:items(id,name) or *,watch:watchlist(world,item:items(*))
 function parseSelect(text='*'){
  const cols=[],embeds=[];let depth=0,cur='';
  for(const ch of text+','){if(ch==='(')depth++;if(ch===')')depth--;if(ch===','&&!depth){if(cur){const m=/^(\w+):(\w+)\((.*)\)$/.exec(cur);if(m)embeds.push({as:m[1],table:m[2],select:m[3]});else cols.push(cur);}cur='';}else cur+=ch;}
  return{cols,embeds};
 }
 async function embed(rows,embeds,uid){
  for(const e of embeds){
   const key=EMBED[e.as].key,ids=[...new Set(rows.map(r=>r[key]).filter(v=>v!=null))];
   const inner=ids.length?await fetchRows(e.table,new URLSearchParams([['select',e.select],['id','in.('+ids.join(',')+')']]),uid,'',true):[];
   const by=new Map(inner.map(r=>[String(r.id),r]));
   for(const r of rows)r[e.as]=by.get(String(r[key]))||null;
  }
  return rows;
 }
 async function fetchRows(table,params,uid,limitOffset='',keepId=false){
  const {cols,embeds}=parseSelect(params.get('select')||'*'),args=[];
  const wanted=cols.includes('*')||!cols.length?null:[...new Set([...cols,...embeds.map(e=>EMBED[e.as].key),...(keepId?['id']:[])])];
  const sql=`select ${wanted?wanted.map(ident).join(','):'*'} from public.${ident(table)}${where(params,args)}${order(params.get('order'))}${limitOffset}`;
  const rows=(await as(uid,()=>db.query(sql,args))).rows;
  return embed(rows,embeds,uid);
 }
 const json=(route,status,body,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'*',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 const pgError=(route,e)=>json(route,e.code==='42501'?403:400,{code:e.code||'XX000',message:e.message,details:null,hint:null});
 async function rpc(route,name,body,uid){
  const fn=(await serial(()=>db.query(`select p.proretset,t.typname,p.proargnames,p.proargtypes::regtype[]::text[] argtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and p.proname=$1 limit 1`,[name]))).rows[0];
  if(!fn)return json(route,404,{code:'PGRST202',message:'Could not find the function public.'+name,details:null,hint:null});
  // Arrays go to array arguments as arrays, and to json arguments as json, as PostgREST does from each argument's type.
  const keys=Object.keys(body),type=k=>fn.argtypes?.[(fn.proargnames||[]).indexOf(k)]||'',args=keys.map(k=>body[k]!==null&&typeof body[k]==='object'&&!type(k).endsWith('[]')?JSON.stringify(body[k]):body[k]);
  const call=`public.${ident(name)}(${keys.map((k,i)=>`${ident(k)} => $${i+1}`).join(',')})`;
  const sql=fn.proretset||fn.typname==='record'?`select * from ${call}`:`select ${call} as v`;
  const res=(await as(uid,()=>db.query(sql,args))).rows;
  return json(route,200,JSON.stringify(fn.proretset||fn.typname==='record'?res:res[0]?.v??null));
 }
 async function handle(route){
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),params=url.searchParams,uid=who(req);
  if(method==='OPTIONS')return json(route,200,'{}');
  seen.push(method+' '+path);
  try{
   if(path==='/auth/v1/signup'){const u=await addUser();return json(route,200,session(u));}
   if(path==='/auth/v1/otp')return json(route,200,{});
   if(path==='/auth/v1/user'){const u=users.get(uid);return u?json(route,200,authUser(u)):json(route,401,{message:'session missing'});}
   if(path==='/auth/v1/token')return json(route,400,{error:'invalid_grant'});
   if(path==='/auth/v1/logout')return json(route,204,'');
   if(path.startsWith('/storage/'))return json(route,404,{message:'no storage in tests'});
   if(path.startsWith('/functions/'))return json(route,404,{message:'no functions in tests'});
   const rest=path.replace('/rest/v1/','');
   if(failing&&rest.includes(failing))return json(route,500,{code:'XX000',message:'Simulated database failure',details:null,hint:null});
   if(rest.startsWith('rpc/'))return await rpc(route,rest.slice(4),JSON.parse(req.postData()||'{}'),uid);
   const table=rest,prefer=req.headers()['prefer']||'';
   if(method==='GET'||method==='HEAD'){
    const limit=params.get('limit'),offset=params.get('offset'),tail=(limit?` limit ${+limit}`:'')+(offset?` offset ${+offset}`:'');
    const exact=/count=exact/.test(prefer);
    if(exact&&method==='HEAD'){const args=[],n=(await as(uid,()=>db.query(`select count(*)::int n from public.${ident(table)}${where(params,args)}`,args))).rows[0].n;return route.fulfill({status:200,headers:{'content-range':`0-0/${n}`,'access-control-allow-origin':'*','access-control-expose-headers':'*'}});}
    const rows=await fetchRows(table,params,uid,tail);
    if(req.headers()['accept']?.includes('vnd.pgrst.object'))return rows.length?json(route,200,rows[0]):json(route,406,{code:'PGRST116',message:'no rows',details:null,hint:null});
    return json(route,200,rows);
   }
   if(method==='POST'){
    const body=JSON.parse(req.postData()||'[]'),list=Array.isArray(body)?body:[body],out=[];
    const conflict=params.get('on_conflict'),merge=/resolution=merge-duplicates/.test(prefer),ignore=/resolution=ignore-duplicates/.test(prefer);
    for(const row of list){
     const keys=Object.keys(row),args=keys.map(k=>row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]);
     const set=keys.filter(k=>!conflict?.split(',').includes(k)).map(k=>`${ident(k)}=excluded.${ident(k)}`).join(',');
     const on=conflict?` on conflict (${conflict.split(',').map(ident).join(',')}) do ${ignore||!set?'nothing':'update set '+set}`:'';
     const r=await as(uid,()=>db.query(`insert into public.${ident(table)}(${keys.map(ident).join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})${on} returning *`,args));
     out.push(...r.rows);
    }
    return json(route,201,/return=representation/.test(prefer)?(req.headers()['accept']?.includes('vnd.pgrst.object')?out[0]:out):'[]');
   }
   if(method==='PATCH'){
    const body=JSON.parse(req.postData()||'{}'),keys=Object.keys(body),args=keys.map(k=>body[k]!==null&&typeof body[k]==='object'?JSON.stringify(body[k]):body[k]);
    const set=keys.map((k,i)=>`${ident(k)}=$${i+1}`).join(',');
    const r=await as(uid,()=>db.query(`update public.${ident(table)} set ${set}${where(params,args)} returning *`,args));
    return json(route,200,r.rows);
   }
   if(method==='DELETE'){const args=[],r=await as(uid,()=>db.query(`delete from public.${ident(table)}${where(params,args)} returning *`,args));return json(route,200,r.rows);}
   return json(route,405,{message:'method'});
  }catch(e){return pgError(route,e);}
 }
 return{db,serial,addUser,session,as,
  fail(name){failing=name;},requests:()=>seen,
  // The browser's saved sign-in, for a page that opens already signed in.
  storageKey:'sb-e2e-auth-token',
  async attach(page){await page.route(HOST+'/**',handle);await page.route('https://osmsdataexplorer.com/**',r=>r.fulfill({status:404,body:''}));},
  async signIn(page,user){await page.addInitScript(([k,v])=>{try{localStorage.setItem(k,v);}catch{}},['sb-e2e-auth-token',JSON.stringify(session(user))]);},
 };
}
