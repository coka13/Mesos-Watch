import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../dist'),mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 let name;try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;}
 // This local preview deliberately has no production database or payment connection.
 if(name==='/config.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end('window.MESOSWATCH_CONFIG={};');return;}
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data);});
});
const port=Number(process.env.PORT)||8187;server.listen(port,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:'+port+' (production services disabled)'));
