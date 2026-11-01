import {observe} from './detection.mjs';

export function createSession(id){return Object.freeze({id,initialBalance:null,balanceAtTotal:null,total:null,items:'',candidate:null});}
const valid=n=>Number.isSafeInteger(n)&&n>=0;
// Conservative corroboration, not independent proof of a trade. Never infer a sale from balance or chat alone.
export function observeStore(state,reading){
 if(!valid(reading.balance))return{kind:'unreadable',state:Object.freeze({...state,candidate:null})};
 if(state.initialBalance===null&&(!valid(reading.total)||reading.confidence<65))return{kind:'unreadable',state};
 const next=observe(state,reading);
 const signature=JSON.stringify([reading.total,reading.balance,reading.items,reading.rawFirst,reading.rawSecond]);
 if(next.kind==='sale'&&state.evidenceCandidate!==signature)return{kind:'pending',state:Object.freeze({...state,evidenceCandidate:signature})};
 const initialBalance=state.initialBalance??reading.balance;
 const balanceAtTotal=['baseline','sale','unchanged'].includes(next.kind)?reading.balance:state.balanceAtTotal;
 const merged=Object.freeze({...state,...next.state,initialBalance,balanceAtTotal,evidenceCandidate:next.kind==='pending'?signature:null});
 if(next.kind!=='sale')return{...next,state:merged};
 const counts=text=>[...String(text||'').matchAll(/\bpurchased\s*[:;]?\s*(\d{1,4})\b/gi)].map(m=>Number(m[1]));
 const a=counts(reading.rawFirst),b=counts(reading.rawSecond);
 const quantity=a.length===1&&b.length===1&&a[0]===b[0]&&a[0]>0?a[0]:null;
 const balanceIncrease=reading.balance-state.balanceAtTotal;
 const corroborated=next.names.length===1&&reading.itemReliable===true&&quantity!==null&&next.amount%quantity===0&&balanceIncrease===next.amount;
 return{...next,state:merged,quantity,balanceIncrease,corroborated,
  reason:corroborated?'Sold-item change, quantity and mesos increase agree.':'Unverified total change: item, quantity or personal balance evidence does not agree.'};
}
