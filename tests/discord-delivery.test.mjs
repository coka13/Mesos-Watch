import assert from 'node:assert/strict';import {deliverDiscord}from '../dist/discord-delivery.mjs';
const url='https://discord.com/api/webhooks/123/test';let calls=0,waits=0;
await deliverDiscord(url,{body:'x'},{fetcher:async()=>++calls===1?{ok:false,status:429,json:async()=>({retry_after:.1})}:{ok:true},wait:async()=>{waits++;}});assert.equal(calls,2);assert.equal(waits,1);
for(const response of [async()=>{throw Error('timeout');},async()=>({ok:false,status:500}),async()=>({ok:false,status:403})]){calls=0;await assert.rejects(deliverDiscord(url,{},{fetcher:async()=>{calls++;return response();}}));assert.equal(calls,1,'ambiguous/permanent failures never retry');}
await assert.rejects(deliverDiscord('https://example.com/webhook',{}),/Invalid/);
console.log('Discord: safe 429 retry, timeout ambiguity, permanent rejection and URL validation passed. No messages sent.');
// Verified-sale embed: icon, name, quantity, mesos, store and timestamp; no icon unless https.
import {saleEmbed,discordBody,sampleSaleEmbed,saleSessionSummary} from '../dist/notifications.mjs';
{const e=saleEmbed({name:'Ghost Suit',qty:2,gross:41358,net:40117,unitPrice:20679,store:'Halloween NX',icon:'https://example.org/1.png',time:'2026-11-02T10:00:00Z',buyer:'Ssr1'});
 assert.equal(e.title,'🛒 Sold in your shop!');assert.equal(e.thumbnail.url,'https://example.org/1.png');assert.equal(e.timestamp,'2026-11-02T10:00:00.000Z');
 assert.deepEqual(e.fields.map(f=>f.name),['Item sold','Sale price','You received','Shop fee','Store','Buyer (OCR)']);assert.equal(e.fields[0].value,'Ghost Suit × 2');assert.match(e.fields[1].value,/41,358 mesos\n20,679 each/);assert.equal(e.fields[3].value,'1,241 mesos');
 assert.equal(saleEmbed({name:'x',qty:1,gross:1,net:1,unitPrice:1,icon:'http://insecure/1.png',time:0}).thumbnail,undefined);
 assert.equal(JSON.parse(discordBody('',null,'a.png',[e]).body).embeds.length,1);
 console.log('Discord sale embed: icon, item, quantity, mesos, store and timestamp passed.');}

// A real payload travels through the delivery function, using an in-memory Discord stub.
{const sample=sampleSaleEmbed('2026-11-03T22:00:00Z');let delivered;
 await deliverDiscord(url,discordBody('',null,'sample.png',[sample]),{fetcher:async(destination,options)=>{delivered=JSON.parse(options.body);assert.equal(destination,url);return{ok:true,status:200};}});
 assert.deepEqual(delivered.allowed_mentions,{parse:[]});assert.match(delivered.embeds[0].title,/^TEST/);assert.match(delivered.embeds[0].description,/no sale/);
 const field=name=>sample.fields.find(f=>f.name===name)?.value;
 assert.equal(field('Sale price'),'21,679 mesos');assert.equal(field('You received'),'**21,029 mesos**\nAfter shop fee');assert.equal(field('Shop fee'),'650 mesos');assert.equal(field('This session'),'**76,567 mesos received**\n5 confirmed sales');assert.equal(field('Current mesos balance'),'22,166 mesos');
 const rows=[{sessionId:'now',corroborated:true,net:21029},{sessionId:'old',corroborated:true,net:999999},{sessionId:'now',corroborated:false,net:50},{sessionId:'now',corroborated:true,net:null},{sessionId:'now',corroborated:true,net:100}];
 assert.deepEqual(saleSessionSummary(rows,'now'),{sessionNet:21129,sessionSales:2});
 const unknown=saleEmbed({name:null,net:100,time:0});assert.equal(unknown.fields[0].value,'Item name unreadable');assert.ok(!unknown.fields.some(f=>['Sale price','Shop fee','This session','Current mesos balance'].includes(f.name)),'never invent unobserved totals or fees');
 assert.ok(!JSON.stringify(unknown).includes('NaN'));
 // Step 3 test from the latest Sold Items record: marked TEST, says it is not a new sale, keeps the real item and buyer.
 const latest=saleEmbed({name:'Metal Koif',qty:1,buyer:'MYMYFem',balance:258809,time:'2026-11-04T10:00:00Z',test:'latest'});
 assert.match(latest.title,/^TEST/);assert.match(latest.description,/latest Sold Items record.*not a new sale/);
 assert.equal(latest.fields[0].value,'Metal Koif × 1');assert.equal(latest.fields.find(f=>f.name==='Buyer (OCR)').value,'MYMYFem');
 assert.ok(!latest.fields.some(f=>['Sale price','You received'].includes(f.name)),'no invented price in the test');
 assert.equal(saleEmbed({name:'Lemona',qty:1,location:'Windia · Ch 35 · FM 8',time:0}).fields.find(f=>f.name==='Location').value,'Windia · Ch 35 · FM 8','FM location in alerts');
 console.log('Notification integration: sample delivery, totals, fee, session isolation, unknown fields and mention suppression passed. No external message sent.');}
