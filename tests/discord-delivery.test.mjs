import assert from 'node:assert/strict';import {deliverDiscord}from '../dist/discord-delivery.mjs';
const url='https://discord.com/api/webhooks/123/test';let calls=0,waits=0;
await deliverDiscord(url,{body:'x'},{fetcher:async()=>++calls===1?{ok:false,status:429,json:async()=>({retry_after:.1})}:{ok:true},wait:async()=>{waits++;}});assert.equal(calls,2);assert.equal(waits,1);
for(const response of [async()=>{throw Error('timeout');},async()=>({ok:false,status:500}),async()=>({ok:false,status:403})]){calls=0;await assert.rejects(deliverDiscord(url,{},{fetcher:async()=>{calls++;return response();}}));assert.equal(calls,1,'ambiguous/permanent failures never retry');}
await assert.rejects(deliverDiscord('https://example.com/webhook',{}),/Invalid/);
console.log('Discord: safe 429 retry, timeout ambiguity, permanent rejection and URL validation passed. No messages sent.');
