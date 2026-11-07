// The Companion end to end, in a real browser, on real game pixels, with real in-browser OCR.
//   node tests/e2e/companion.e2e.mjs [chrome|msedge] [--shots dir]
import os from 'node:os';import path from 'node:path';import fs from 'node:fs';
import assert from 'node:assert/strict';
import {serve,launch,newPage,checks} from './harness.mjs';
import {writeFrames,base,frame,titled} from './frames.mjs';

const channel=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'chrome',shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const dir=process.env.E2E_FRAMES=path.join(os.tmpdir(),'mw-e2e-frames');
await writeFrames(dir,{
 start:{exp:49732,pct:40.51},up1:{exp:50078,pct:40.79},up2:{exp:50597,pct:41.21},up3:{exp:51263,pct:41.75},
 hidden:{exp:51263,pct:41.75,cover:true},up4:{exp:52120,pct:42.45},
 died:{exp:47000,pct:38.28},level:{exp:321,pct:.26},next:{exp:521,pct:.42},away:{exp:1000,pct:.81},back:{exp:1100,pct:.89},
});
// Maps with no real capture yet: the title is printed over the real minimap panel (see titled in frames.mjs).
{const b=await base(),f=frame(b,{exp:1100,pct:.89});for(const [file,name] of Object.entries({'map-henesys':'Henesys','jq-1':'B1 <Area 1>','jq-2':'B1 <Area 2>','jq-3':'B1 <Subway Depot>','jq-out':'Kerning City'}))await(await titled(b,f,name)).write(path.join(dir,file+'.png'));}
const server=await serve(),browser=await launch(channel),errors=[],c=checks();
console.log(`Companion end to end · ${channel} ${browser.version()}`);
const page=await newPage(browser,{url:server.url+'/#companion',errors});
const show=name=>page.evaluate(n=>window.__capture.show('/__frames/'+n+'.png'),name);
const text=id=>page.locator('#'+id).textContent();
const until=(fn,arg,timeout=60000)=>page.waitForFunction(fn,arg,{timeout,polling:200});
const untilText=(id,want,timeout)=>until(([i,w])=>document.getElementById(i)?.textContent.includes(w),[id,want],timeout);
const shot=async name=>{if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,channel+'-'+name+'.png'),fullPage:true});}};

await c.step('page opens with sharing off and every control honest',async()=>{
 await page.waitForSelector('[data-view="companion"]:not([hidden])');
 assert.match(await text('cp-badge'),/Not sharing/);
 for(const id of ['cp-pause','cp-new','cp-stop'])assert.equal(await page.isDisabled('#'+id),true,id);
 assert.equal(await page.evaluate(()=>document.querySelector('#nav a[aria-current="page"]')?.textContent),'Companion');
 await untilText('cp-quest','Walk into a party quest');
 assert.match(await text('cp-credit'),/OSMS Data Explorer.*CC BY 4\.0.*Nexon/s,'data credit');
});
await c.step('cancelling the screen picker explains itself and starts nothing',async()=>{
 await page.evaluate(()=>{window.__capture.cancel=true;});await page.click('#cp-connect');
 await untilText('cp-status','cancelled');assert.equal(await page.isDisabled('#cp-pause'),true);
 await page.evaluate(()=>{window.__capture.cancel=false;});
});
await c.step('sharing finds the status bar and reads EXP',async()=>{
 await show('start');await page.click('#cp-connect');
 await untilText('cp-badge','Tracking');await untilText('cp-exp','49,732');
 assert.equal(await text('cp-pct'),'40.51%');
 assert.equal(await page.evaluate(()=>window.__capture.picks),2,'the picker opened once more, not repeatedly');
});
await c.step('level and job are read by OCR, and the map from the minimap',async()=>{
 await untilText('cp-level','32',120000);await untilText('cp-job','Cleric',60000);await untilText('cp-map','Free Market <8>',60000);
 return (await text('cp-job'))+' · '+(await text('cp-map'));
});
await c.step('Store Watcher was not started by the Companion',async()=>{
 assert.equal(await page.evaluate(()=>document.getElementById('badge').textContent.includes('Not watching')),true);
});
await c.step('gains count after two frames, once each',async()=>{
 await show('up1');await untilText('cp-gained','346 EXP gained');
 await show('up2');await untilText('cp-gained','865 EXP gained');
 await page.waitForTimeout(3000);assert.match(await text('cp-gained'),/^865 EXP gained/,'held frames add nothing');
 await shot('training');
});
await c.step('a covered bar loses nothing and invents nothing',async()=>{
 await show('hidden');await untilText('cp-d-exp','unreadable');
 assert.match(await text('cp-gained'),/^865 EXP gained/);
 await show('up3');await untilText('cp-gained','1,531 EXP gained');
});
await c.step('the time to level appears only once there is a rate',async()=>{
 await page.waitForFunction(()=>/\d/.test(document.getElementById('cp-tolevel').textContent),null,{timeout:45000});
 assert.match(await text('cp-left'),/EXP to go/);return text('cp-tolevel');
});
await c.step('a death is a loss, never a negative gain',async()=>{
 await show('up4');await untilText('cp-gained','2,388 EXP gained');
 await show('died');await untilText('cp-gained','5,120 lost');assert.match(await text('cp-gained'),/^2,388 EXP gained/);
});
await c.step('a level-up counts the rest of the level and raises the level',async()=>{
 await show('level');await untilText('cp-gained','1 level up');
 assert.equal(await text('cp-level'),'33');
 const gained=+(await text('cp-gained')).match(/^([\d,]+)/)[1].replace(/,/g,'');
 assert.ok(Math.abs(gained-(2388+122766-47000+321))<400,'gain across the level: '+gained);
 await show('next');await untilText('cp-exp','521');
});
await c.step('pause stops counting; what changed meanwhile is not a gain',async()=>{
 const before=await text('cp-gained');await page.click('#cp-pause');await untilText('cp-badge','Paused');assert.equal(await text('cp-pause'),'▶ Resume');
 await show('away');await page.waitForTimeout(2500);assert.equal((await text('cp-gained')).split(' · ')[0],before.split(' · ')[0]);
 await page.click('#cp-pause');await untilText('cp-exp','1,000');assert.equal((await text('cp-gained')).split(' · ')[0],before.split(' · ')[0]);
 await show('back');await untilText('cp-exp','1,100');
 const a=+before.match(/^([\d,]+)/)[1].replace(/,/g,''),b=+(await text('cp-gained')).match(/^([\d,]+)/)[1].replace(/,/g,'');assert.equal(b-a,100);
});
await c.step('tables and chart show the session',async()=>{
 assert.ok(await page.locator('#cp-history tr').count()>=1,'history row');assert.match(await page.locator('#cp-history tr').first().textContent(),/Free Market <8>/);
 assert.equal(await page.locator('#cp-sessions tr').count(),1);
 await page.click('#cp-ranges button[data-range="all"]');await page.waitForSelector('#cp-chart .exp-bar');
 await page.locator('details:has(#cp-readings)').evaluate(d=>{d.open=true;});assert.ok(await page.locator('#cp-readings tr').count()>=8);
 assert.match(await page.locator('#cp-readings').textContent(),/▲ level/);
 await shot('tables');
});
await c.step('a new map starts a new history row and fills the monster table',async()=>{
 await show('map-henesys');await untilText('cp-map','Henesys');assert.equal(await page.locator('#cp-history tr').count(),2);
});
await c.step('a jump quest is followed stage by stage from the map name (synthetic title)',async()=>{
 await show('jq-1');await untilText('cp-map','B1 <Area 1>');await untilText('cp-quest','Shumi');
 assert.match(await text('cp-quest'),/Reach the Treasure Chest/);assert.ok((await text('cp-quest')).includes('1 / 3'));
 assert.ok((await page.locator('#cp-monsters tr').count())>=1,'monsters from the data');assert.match(await text('cp-monsters'),/Super Jr. Necki/);
 await show('jq-2');await untilText('cp-quest','2 / 3');
 await show('jq-3');await untilText('cp-quest','3 / 3');assert.equal(await page.locator('#cp-quest .cp-stages li.done').count(),2);
 await shot('quest');
 await show('jq-out');await untilText('cp-map','Kerning City');await untilText('cp-quest','Walk into a party quest');
 await page.locator('.cp-routes').nth(1).evaluate(d=>{d.open=true;});assert.ok((await text('cp-quest')).includes('1/1 finished'));
 await show('back');
});
await c.step('what-the-reader-sees panel reports real values',async()=>{
 await page.locator('details:has(#cp-d-exp)').evaluate(d=>{d.open=true;});await untilText('cp-d-exp','1,100');
 assert.match(await text('cp-d-source'),/^\d+×\d+$/);assert.match(await text('cp-d-match'),/^\d+%$/);
});
await c.step('Save a frame downloads a picture and uploads nothing',async()=>{
 const [d]=await Promise.all([page.waitForEvent('download'),page.click('#cp-save-frame')]);
 assert.match(d.suggestedFilename(),/^mesos-watch-frame-.*\.png$/);await untilText('cp-save-note','not uploaded');
});
await c.step('the pop-out opens, follows the session and controls it',async()=>{
 assert.equal(await page.isVisible('#cp-popout'),true);await page.click('#cp-popout');
 await page.waitForFunction(()=>window.documentPictureInPicture?.window?.document.getElementById('p-pct')?.textContent.includes('%'),null,{timeout:15000});
 const read=id=>page.evaluate(i=>window.documentPictureInPicture.window.document.getElementById(i).textContent,id);
 assert.ok((await read("p-level")).startsWith("Lv. 3"));assert.ok((await read("p-rate")).includes("EXP/min"));
 await page.evaluate(()=>window.documentPictureInPicture.window.document.getElementById('p-pause').click());await untilText('cp-badge','Paused');
 await page.waitForFunction(()=>window.documentPictureInPicture.window.document.getElementById('p-pause').textContent.includes('Resume'));
 await page.evaluate(()=>window.documentPictureInPicture.window.document.getElementById('p-pause').click());await untilText('cp-badge','Tracking');
 await page.click('#cp-popout');await page.waitForFunction(()=>!window.documentPictureInPicture.window);await untilText('cp-popout','Pop out');
});
await c.step('the browser ending the share stops reading and releases the capture',async()=>{
 await page.evaluate(()=>window.__capture.end());await untilText('cp-badge','Not sharing');await untilText('cp-status','history is saved');
 assert.equal(await page.evaluate(()=>window.__capture.liveTracks()),0);assert.match(await text('cp-connect'),/Share again/);
 assert.equal(await page.evaluate(()=>document.getElementById('video').srcObject),null,'video released');
});
await c.step('sharing again continues the same session',async()=>{
 const before=await text('cp-gained');await show('back');await page.click('#cp-connect');await untilText('cp-badge','Tracking');
 assert.equal(await page.locator('#cp-sessions tr').count(),1);assert.equal((await text('cp-gained')).split(' · ')[0],before.split(' · ')[0]);
});
await c.step('Stop saves the session and ends sharing',async()=>{
 await page.click('#cp-stop');await untilText('cp-status','Sharing has ended');await untilText('cp-badge','Not sharing');
 assert.equal(await page.evaluate(()=>window.__capture.liveTracks()),0);assert.equal(await page.isDisabled('#cp-stop'),true);
 assert.equal(await page.locator('#cp-sessions tr').count(),1);
});
await c.step('sessions survive a reload',async()=>{
 await page.reload();await page.waitForSelector('[data-view="companion"]:not([hidden])');await page.waitForSelector('#cp-sessions tr');
 assert.equal(await page.locator('#cp-sessions tr').count(),1);assert.ok(await page.locator('#cp-chart .exp-bar').count()>=1,'the chart shows the last session');
});
await c.step('Settings clears the training history',async()=>{
 await page.goto(server.url+'/#settings');await page.click('#set-clear-training');await untilText('set-clear-note','cleared');
 await page.goto(server.url+'/#companion');await page.reload();await page.waitForSelector('[data-view="companion"]:not([hidden])');await page.waitForTimeout(400);
 assert.equal(await page.locator('#cp-sessions tr').count(),0);
});
await c.step('no page errors',async()=>{assert.deepEqual(errors,[]);});
await page.context().close();await browser.close();await server.close();
if(!c.summary())process.exit(1);
