import fs from 'node:fs';import path from 'node:path';import {spawnSync}from 'node:child_process';import assert from 'node:assert/strict';
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const source=files('dist'),server=files('supabase/functions');
for(const f of [...source,...server].filter(f=>/\.(mjs|js|ts)$/.test(f))){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});assert.equal(r.status,0,f+'\n'+r.stderr);}
const html=fs.readFileSync('dist/index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'HTML IDs must be unique');
for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){const target=m[1].split('?')[0];if(!/^(?:https?:|data:)/.test(target))assert.ok(fs.existsSync(path.join('dist',target)),'Missing asset '+target);}
for(const f of source){assert.ok(!/(^|[\\/])\.env/.test(f),'Environment file in published assets');if(/\.(mjs|js|html)$/.test(f))assert.ok(!/\b(?:sk_live_|sk_test_|whsec_)[A-Za-z0-9]{12,}/.test(fs.readFileSync(f,'utf8')),'Secret pattern in '+f);}
assert.ok(fs.readFileSync('dist/site.css','utf8').includes('prefers-reduced-motion'));
console.log('Release checks: JS/TS syntax, unique IDs, local assets, secret patterns and reduced-motion support passed.');
