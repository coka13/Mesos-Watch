export function discordBody(content,blob=null,filename='sold-items.png'){
 const payload={username:'Mesos-Watch',content:String(content).slice(0,1950),allowed_mentions:{parse:[]}};
 if(!blob)return{body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}};
 const body=new FormData();body.append('payload_json',JSON.stringify(payload));body.append('files[0]',blob,filename);
 return{body};
}
