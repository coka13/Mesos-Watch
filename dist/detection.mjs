export function parseTotal(text) {
  const value=String(text).trim();
  // A tightly cropped numeric total must contain no alphabetic characters.
  if(!/^[\d, .\s]+$/.test(value)) return null;
  const digits=value.replace(/[, .\s]/g,'');
  if(!/^\d{1,12}$/.test(digits)) return null;
  const n=Number(digits);return Number.isSafeInteger(n)?n:null;
}
export function normalizeLines(text) {
  return String(text).split('\n').map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean);
}
export function newLines(before,after) {
  const count=new Map();
  for(const line of normalizeLines(before)) count.set(line,(count.get(line)||0)+1);
  return normalizeLines(after).filter(line=>{const n=count.get(line)||0;if(n){count.set(line,n-1);return false;}return true;});
}
export function itemNames(before,after) {
  return newLines(before,after).filter(s=>/[a-zA-Z]{3}/.test(s))
    .map(s=>s.replace(/\s+\d[\d, .]*(?:\s*mesos?)?$/i,'').trim()).filter(Boolean).slice(0,10);
}
export function observe(state,reading) {
  if(reading.total===null || reading.confidence<65) return {kind:'unreadable',state:{...state,candidate:null}};
  if(state.total===null) return {kind:'baseline',state:{total:reading.total,items:reading.items,candidate:null}};
  if(reading.total<state.total) return {kind:'reset',state:{...state,candidate:null}};
  if(reading.total===state.total) return {kind:'unchanged',state:{...state,candidate:null}};
  const key=reading.total+'|'+normalizeLines(reading.items).join('|');
  if(state.candidate!==key) return {kind:'pending',state:{...state,candidate:key}};
  return {kind:'sale',amount:reading.total-state.total,names:itemNames(state.items,reading.items),state:{total:reading.total,items:reading.items,candidate:null}};
}
