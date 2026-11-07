// End-to-end harness: the real pages in real Chrome or Edge, served from dist/. Two things are stood in for, and only these:
//  - The screen picker: getDisplayMedia returns a stream of a canvas that draws frames the test chooses, so the page's own capture,
//    reading and OCR run unchanged on them.
//  - Supabase's REST layer: requests to the configured project are answered from PGlite running every migration, so the site's real
//    SQL, row-level security and functions run. Only the HTTP translation (mock-rest.mjs) is ours.
// Frames are real captures. To make EXP change, digits are spliced from real digit pixels of the same capture (frames.mjs).
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {chromium} from 'playwright-core';

const root=path.resolve(import.meta.dirname,'../../dist');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};
export function serve({port=0,config=null}={}){
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(name==='/config.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end('window.MESOSWATCH_CONFIG='+JSON.stringify(config||{})+';');return;}
  if(name.startsWith('/__frames/')){fs.readFile(path.join(process.env.E2E_FRAMES,name.slice(10)),(e,d)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'}).end(d);});return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(e,d)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(d);});
 });
 return new Promise(r=>server.listen(port,'127.0.0.1',()=>r({url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(c=>{server.closeAllConnections();server.close(c);})})));
}
export const launch=(channel='chrome',options={})=>chromium.launch({channel,headless:true,args:['--autoplay-policy=no-user-gesture-required'],...options});

// Replaces the screen picker. __capture.show(url) changes what the "game" shows; __capture.end() is the player pressing Stop sharing.
export const stubCapture=()=>{
 const canvas=document.createElement('canvas'),g=canvas.getContext('2d');let image=null;canvas.width=1280;canvas.height=720;
 const paint=()=>{if(image)g.drawImage(image,0,0);};
 setInterval(paint,100);
 window.__capture={stream:null,picks:0,cancel:false,
  async show(url){const i=new Image();i.src=url;await i.decode();canvas.width=i.width;canvas.height=i.height;image=i;paint();},
  end(){for(const t of this.stream?.getTracks()||[]){t.stop();t.dispatchEvent(new Event('ended'));}},
  liveTracks(){return(this.stream?.getTracks()||[]).filter(t=>t.readyState==='live').length;}};
 const media=navigator.mediaDevices||{};if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:media});
 media.getDisplayMedia=async()=>{window.__capture.picks++;if(window.__capture.cancel)throw new DOMException('Permission denied','NotAllowedError');window.__capture.stream=canvas.captureStream(10);return window.__capture.stream;};
};
export async function newPage(browser,{url,viewport={width:1366,height:900},capture=true,mock=null,errors=[]}={}){
 const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage();
 page.on('pageerror',e=>errors.push('pageerror: '+e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|net::ERR|Failed to load resource|WebSocket/.test(m.text()))errors.push('console: '+m.text());});
 if(capture)await page.addInitScript(stubCapture);
 if(mock)await mock.attach(page);
 if(url)await page.goto(url);
 return page;
}
export const checks=()=>{
 const list=[];
 return{list,ok:(name,detail='')=>{list.push({name,ok:true});console.log('  ✓ '+name+(detail?' — '+detail:''));},
  async step(name,fn){try{const d=await fn();list.push({name,ok:true});console.log('  ✓ '+name+(d?' — '+d:''));}catch(e){list.push({name,ok:false,error:e.message});console.log('  ✗ '+name+'\n      '+String(e.message).split('\n').slice(0,6).join('\n      '));}},
  summary(){const bad=list.filter(c=>!c.ok);console.log(`\n${list.length-bad.length}/${list.length} checks passed`);return bad.length===0;}};
};
