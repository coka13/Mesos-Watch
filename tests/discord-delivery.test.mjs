import assert from 'node:assert/strict';import {deliverDiscord}from '../dist/discord-delivery.mjs';
const url='https://discord.com/api/webhooks/123/test';let calls=0,waits=0;
await deliverDiscord(url,{body:'x'},{fetcher:async()=>++calls===1?{ok:false,status:429,json:async()=>({retry_after:.1})}:{ok:true},wait:async()=>{waits++;}});assert.equal(calls,2);assert.equal(waits,1);
for(const response of [async()=>{throw Error('timeout');},async()=>({ok:false,status:500}),async()=>({ok:false,status:403})]){calls=0;await assert.rejects(deliverDiscord(url,{},{fetcher:async()=>{calls++;return response();}}));assert.equal(calls,1,'ambiguous/permanent failures never retry');}
await assert.rejects(deliverDiscord('https://example.com/webhook',{}),/Invalid/);
console.log('Discord: safe 429 retry, timeout ambiguity, permanent rejection and URL validation passed. No messages sent.');
// Verified-sale embed: icon, name, quantity, mesos, store and timestamp; no icon unless https.
import {saleEmbed,discordBody} from '../dist/notifications.mjs';
{const e=saleEmbed({name:'Ghost Suit',qty:2,gross:41358,net:40117,unitPrice:20679,store:'Halloween NX',icon:'https://example.org/1.png',time:'2026-11-02T10:00:00Z',buyer:'Ssr1'});
 assert.equal(e.title,'Sold: Ghost Suit');assert.equal(e.thumbnail.url,'https://example.org/1.png');assert.equal(e.timestamp,'2026-11-02T10:00:00.000Z');
 assert.deepEqual(e.fields.map(f=>f.name),['Quantity','Sold for','Received','Store','Buyer (OCR)']);assert.match(e.fields[1].value,/41,358 mesos \(20,679 each\)/);
 assert.equal(saleEmbed({name:'x',qty:1,gross:1,net:1,unitPrice:1,icon:'http://insecure/1.png',time:0}).thumbnail,undefined);
 assert.equal(JSON.parse(discordBody('',null,'a.png',[e]).body).embeds.length,1);
 console.log('Discord sale embed: icon, item, quantity, mesos, store and timestamp passed.');}
