// Webhooks have no idempotency keys: retry only explicit 429 rejections, never ambiguous sends.
export async function deliverDiscord(url,payload,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeout=20000}={}){
 let parsed;try{parsed=new URL(url);}catch{throw Error('Invalid Discord webhook.');}
 if(parsed.protocol!=='https:'||parsed.hostname!=='discord.com'||!/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(parsed.pathname))throw Error('Invalid Discord webhook.');
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await fetcher(url,{method:'POST',...payload,signal:AbortSignal.timeout(timeout)});}catch{throw Error('Discord delivery could not be confirmed. No automatic resend, to avoid duplicate messages.');}
  if(response.ok)return;
  if(response.status===429&&attempt<2){const body=await response.json().catch(()=>({})),delay=Number(body.retry_after);if(Number.isFinite(delay)&&delay>=0&&delay<=30){await wait(Math.max(250,Math.ceil(delay*1000)));continue;}}
  throw Error(response.status===429?'Discord rate limit persists. Message was not delivered.':response.status>=500?'Discord returned a server error; delivery is uncertain. Check the channel before resending.':'Discord refused the message (HTTP '+response.status+').');
 }
}
