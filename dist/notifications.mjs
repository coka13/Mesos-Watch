export function discordBody(content,blob=null,filename='sold-items.png',embeds=null){
 const payload={username:'Mesos-Watch',content:String(content).slice(0,1950),allowed_mentions:{parse:[]}};
 if(embeds?.length)payload.embeds=embeds.slice(0,10);
 if(!blob)return{body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}};
 const body=new FormData();body.append('payload_json',JSON.stringify(payload));body.append('files[0]',blob,filename);
 return{body};
}

// A verified My Store sale. Only https icons are attached (Discord fetches them); text fields are length-capped.
const n=v=>Number(v).toLocaleString('en-US');
export function saleEmbed({name,qty,gross,net,unitPrice,store,icon,time,buyer,sessionNet,sessionSales,balance,test=false}){
 const known=v=>Number.isSafeInteger(v)&&v>=0;
 const plain=v=>String(v).replace(/[\\`*_~|>]/g,'\\$&');
 const fields=[{name:'Item sold',value:plain(name||'Item name unreadable').slice(0,250)+(known(qty)&&qty>0?' × '+qty:''),inline:false}];
 if(known(gross))fields.push({name:'Sale price',value:n(gross)+' mesos'+(qty>1&&known(unitPrice)?'\n'+n(unitPrice)+' each':''),inline:true});
 if(known(net))fields.push({name:'You received',value:'**'+n(net)+' mesos**'+(known(gross)?'\nAfter shop fee':''),inline:true});
 if(known(gross)&&known(net)&&gross>=net)fields.push({name:'Shop fee',value:n(gross-net)+' mesos',inline:true});
 if(known(sessionNet)&&known(sessionSales))fields.push({name:'This session',value:'**'+n(sessionNet)+' mesos received**\n'+sessionSales+' confirmed '+(sessionSales===1?'sale':'sales'),inline:true});
 if(known(balance))fields.push({name:'Current mesos balance',value:n(balance)+' mesos',inline:true});
 if(store)fields.push({name:'Store',value:String(store).slice(0,100),inline:true});
 if(buyer)fields.push({name:'Buyer (OCR)',value:String(buyer).slice(0,50),inline:true});
 const embed={title:test?'TEST · Shop sale notification':'🛒 Sold in your shop!',description:test?'Example only — no sale or mesos change was recorded.':'A new sale was confirmed from your screen readings.',color:test?0x548b9e:0x4f8a45,fields,timestamp:new Date(time).toISOString(),footer:{text:test?'Mesos-Watch · notification test':'Mesos-Watch · OCR-confirmed sale · current watching session'}};
 if(/^https:\/\//.test(icon||''))embed.thumbnail={url:icon};
 return embed;
}

export function saleSessionSummary(rows,sessionId){
 const confirmed=rows.filter(r=>r.sessionId===sessionId&&r.corroborated===true&&Number.isSafeInteger(r.net)&&r.net>=0);
 return{sessionNet:confirmed.reduce((sum,r)=>sum+r.net,0),sessionSales:confirmed.length};
}

export function sampleSaleEmbed(time=new Date().toISOString()){
 return saleEmbed({name:'Ghost Suit',qty:1,gross:21679,net:21029,unitPrice:21679,store:'My MapleStory shop',sessionNet:76567,sessionSales:5,balance:22166,time,test:true});
}
