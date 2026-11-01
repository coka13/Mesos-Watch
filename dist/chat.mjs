const systemLine=/^(?:\[?(?:system|notice|notification)\]?\s*[:>]|.*\bhas\s+(?:entered|left)\s+(?:the\s+)?(?:room|shop)\b|.*\b(?:joined|left)\s+the\s+room\b)/i;
export function parseChat(text){
 const messages=[];
 for(const raw of String(text).split('\n')){
  const line=raw.trim().replace(/\s+/g,' ');if(!line)continue;
  if(/^\[?(?:system|notice|notification)\]?\s*[:>]/i.test(line))continue;
  const match=line.match(/^(?:\[([\p{L}\p{N}_-]{2,24})\]\s*:?|([\p{L}\p{N}_-]{2,24})\s*[:>])\s*(.+)$/u);
  if(match){const user=match[1]||match[2];messages.push({user,text:match[3].trim()});}
  else if(systemLine.test(line))continue;
  else if(messages.length){messages[messages.length-1].text+=' '+line;}
 }
 return messages.map(m=>({...m,text:m.text.slice(0,1500),key:(m.user+': '+m.text).toLowerCase().replace(/\s+/g,' ').trim()}));
}
export function observeChat(state,reading){
 if(reading.confidence<65)return{kind:'unreadable',state:{...state,candidate:null}};
 const messages=parseChat(reading.text),keys=messages.map(m=>m.key),signature=JSON.stringify(keys);
 if(!state.ready)return{kind:'baseline',state:{ready:true,keys,candidate:null}};
 if(JSON.stringify(state.keys)===signature)return{kind:'unchanged',state:{...state,candidate:null}};
 if(state.candidate!==signature)return{kind:'pending',state:{...state,candidate:signature}};
 const next={ready:true,keys,candidate:null};
 if(!keys.length)return{kind:'reset',state:next};
 let overlap=0;
 for(let n=Math.min(state.keys.length,keys.length);n>0;n--){if(state.keys.slice(-n).every((key,i)=>key===keys[i])){overlap=n;break;}}
 // A completely different visible history can be scrolling or a reopened shop.
 // Establish a new baseline instead of replaying old messages as new alerts.
 if(state.keys.length&&!overlap)return{kind:'reset',state:next};
 const added=messages.slice(overlap);
 return{kind:added.length?'messages':'unchanged',messages:added,state:next};
}
