export function discordBody(content,blob=null,filename='sold-items.png',embeds=null){
 const payload={username:'Mesos-Watch',content:String(content).slice(0,1950),allowed_mentions:{parse:[]}};
 if(embeds?.length)payload.embeds=embeds.slice(0,10);
 if(!blob)return{body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}};
 const body=new FormData();body.append('payload_json',JSON.stringify(payload));body.append('files[0]',blob,filename);
 return{body};
}

// A verified My Store sale. Only https icons are attached (Discord fetches them); text fields are length-capped.
const n=v=>Number(v).toLocaleString('en-US');
export function saleEmbed({name,qty,gross,net,unitPrice,store,icon,time,buyer}){
 const fields=[{name:'Quantity',value:String(qty),inline:true},{name:'Sold for',value:n(gross)+' mesos'+(qty>1?' ('+n(unitPrice)+' each)':''),inline:true},{name:'Received',value:n(net)+' mesos after fee',inline:true}];
 if(store)fields.push({name:'Store',value:String(store).slice(0,100),inline:true});
 if(buyer)fields.push({name:'Buyer (OCR)',value:String(buyer).slice(0,50),inline:true});
 const embed={title:('Sold: '+String(name)).slice(0,250),color:0xf2a93b,fields,timestamp:new Date(time).toISOString(),footer:{text:'Mesos-Watch · verified from Sold Items, mesos balance and fee'}};
 if(/^https:\/\//.test(icon||''))embed.thumbnail={url:icon};
 return embed;
}
