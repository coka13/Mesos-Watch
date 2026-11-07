// Price history chart as SVG markup (pure: no DOM), from price_history rows {bucket, kind, low, p25, median, p75, high, n}.
// Asking prices: orange median line with the middle half (p25–p75) as a band; the extremes are in each point's tooltip,
// so one misread price cannot flatten the chart. Rows seen sold in shops (their listed price): brown dots. Confirmed sales:
// green diamonds. Every value drawn is an observed price. Older rows without p25/p75 band from low to high.
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shortMesos=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:20});
const RANGE_MS={'24h':864e5,'7d':6048e5,'30d':2592e6,'90d':7776e6};

export function chartSvg(rows,{range='7d',now=Date.now(),width=720,height=240}={}){
 const pts=rows.map(r=>{const low=+r.low,high=+r.high,p25=r.p25!=null?+r.p25:low,p75=r.p75!=null?+r.p75:high;
  return{t:+new Date(r.bucket),kind:r.kind,low,high,p25,p75,med:+r.median,n:+r.n};}).filter(p=>Number.isFinite(p.t)&&p.med>0);
 const asks=pts.filter(p=>p.kind==='ask').sort((a,b)=>a.t-b.t),sales=pts.filter(p=>p.kind==='sale'),sold=pts.filter(p=>p.kind==='sold');
 const P={l:150,r:14,t:14,b:28},W=width-P.l-P.r,H=height-P.t-P.b;
 const t1=now,t0=now-(RANGE_MS[range]||RANGE_MS['7d']);
 if(!pts.length)return`<svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="No prices recorded in this period"><text x="${width/2}" y="${height/2}" text-anchor="middle" class="empty">No prices recorded in this period yet</text></svg>`;
 let lo=Math.min(...pts.map(p=>Math.min(p.p25,p.med))),hi=Math.max(...pts.map(p=>Math.max(p.p75,p.med)));
 if(lo===hi){lo*=.9;hi*=1.1;}const pad=(hi-lo)*.08;lo=Math.max(0,lo-pad);hi+=pad;
 const x=t=>P.l+W*Math.min(1,Math.max(0,(t-t0)/(t1-t0))),y=v=>P.t+H*(1-(Math.min(hi,Math.max(lo,v))-lo)/(hi-lo));
 const out=[`<svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Asking prices ${shortMesos(Math.min(...pts.map(p=>p.low)))} to ${shortMesos(Math.max(...pts.map(p=>p.high)))} mesos`)}">`];
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,yy=y(v).toFixed(1);out.push(`<line class="grid" x1="${P.l}" x2="${width-P.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${P.l-6}" y="${(+yy+4).toFixed(1)}" text-anchor="end">${esc(shortMesos(v))}</text>`);}
 const fmtT=t=>{const d=new Date(t);return range==='24h'?d.toLocaleTimeString([],{hour:'numeric'}):d.toLocaleDateString([],{month:'short',day:'numeric'});};
 for(let i=0;i<=4;i++){const t=t0+(t1-t0)*i/4;out.push(`<text class="axis" x="${x(t).toFixed(1)}" y="${height-8}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${esc(fmtT(t))}</text>`);}
 if(asks.length>1)out.push(`<path class="band" d="M${asks.map(p=>x(p.t).toFixed(1)+','+y(p.p75).toFixed(1)).join('L')}L${asks.slice().reverse().map(p=>x(p.t).toFixed(1)+','+y(p.p25).toFixed(1)).join('L')}Z"/>`,`<polyline class="ask" points="${asks.map(p=>x(p.t).toFixed(1)+','+y(p.med).toFixed(1)).join(' ')}"/>`);
 for(const p of asks)out.push(`<circle class="ask-pt" cx="${x(p.t).toFixed(1)}" cy="${y(p.med).toFixed(1)}" r="3.5"><title>${esc(`${fmtT(p.t)} · asking median ${shortMesos(p.med)} (middle half ${shortMesos(p.p25)}–${shortMesos(p.p75)}, low ${shortMesos(p.low)}, high ${shortMesos(p.high)}) · ${p.n} seen · FM Scanner`)}</title></circle>`);
 for(const p of sold)out.push(`<circle class="sold-pt" cx="${x(p.t).toFixed(1)}" cy="${y(p.med).toFixed(1)}" r="4"><title>${esc(`${fmtT(p.t)} · seen sold, listed at ${shortMesos(p.med)} (median of ${p.n}) · FM Scanner`)}</title></circle>`);
 for(const p of sales)out.push(`<rect class="sale-pt" x="${(x(p.t)-4).toFixed(1)}" y="${(y(p.med)-4).toFixed(1)}" width="8" height="8" transform="rotate(45 ${x(p.t).toFixed(1)} ${y(p.med).toFixed(1)})"><title>${esc(`${fmtT(p.t)} · confirmed sale ${shortMesos(p.med)} (median of ${p.n}) · reviewed`)}</title></rect>`);
 out.push('</svg>');
 return out.join('');
}

// EXP per minute as bars, one series, from [{minute,gained}] (companion-core series). Long sessions group minutes so that bars stay
// wide enough to read and to point at. Every bar's value is in its tooltip, and a tall hit area makes low bars easy to hover.
export function expChartSvg(points,{width=720,height=200}={}){
 const empty=text=>`<svg class="price-chart exp-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(text)}"><text x="${width/2}" y="${height/2}" text-anchor="middle" class="empty">${esc(text)}</text></svg>`;
 if(!points.some(p=>p.gained>0))return empty('No EXP gained in this period yet');
 const P={l:64,r:12,t:12,b:24},W=width-P.l-P.r,H=height-P.t-P.b,MAX_BAR=24,span=Math.max(1,Math.ceil(points.length/(W/6))),bars=[];
 for(let i=0;i<points.length;i+=span){const part=points.slice(i,i+span);bars.push({from:part[0].minute,to:part.at(-1).minute,value:part.reduce((n,p)=>n+p.gained,0)/part.length});}
 // A short session keeps narrow bars and leaves the rest of the plot empty: one minute of training should not look like a wall.
 const top=Math.max(...bars.map(b=>b.value))*1.08,step=Math.min(MAX_BAR,W/bars.length),gap=Math.min(2,step*.25),y=v=>P.t+H*(1-v/top);
 const out=[`<svg class="price-chart exp-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`EXP per minute, highest ${shortMesos(Math.round(Math.max(...bars.map(b=>b.value))))}`)}">`];
 for(let i=0;i<=3;i++){const v=top*i/3,yy=y(v).toFixed(1);out.push(`<line class="grid" x1="${P.l}" x2="${width-P.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${P.l-6}" y="${(+yy+4).toFixed(1)}" text-anchor="end">${esc(shortMesos(Math.round(v)))}</text>`);}
 const base=y(0),r=Math.min(4,(step-gap)/2);
 bars.forEach((b,i)=>{
  const x=P.l+i*step+gap/2,w=Math.max(1,step-gap),h=base-y(b.value),when=b.from===b.to?`Minute ${b.from+1}`:`Minutes ${b.from+1}–${b.to+1}`;
  const shape=b.value>0?`<path class="exp-bar" d="M${x.toFixed(1)},${base.toFixed(1)}v${-Math.max(0,h-r).toFixed(1)}q0,${-r.toFixed(1)} ${r.toFixed(1)},${-r.toFixed(1)}h${(w-2*r).toFixed(1)}q${r.toFixed(1)},0 ${r.toFixed(1)},${r.toFixed(1)}v${Math.max(0,h-r).toFixed(1)}z"/>`:'';
  out.push(`<g class="exp-col"><rect class="exp-hit" x="${(P.l+i*step).toFixed(1)}" y="${P.t}" width="${step.toFixed(1)}" height="${H}"/>${shape}<title>${esc(when+': '+shortMesos(Math.round(b.value))+' EXP per minute')}</title></g>`);
 });
 const label=m=>'Minute '+(m+1);
 out.push(`<text class="axis" x="${P.l}" y="${height-6}">${label(bars[0].from)}</text>${bars.length>1?`<text class="axis" x="${(P.l+step*bars.length).toFixed(1)}" y="${height-6}" text-anchor="end">${label(bars.at(-1).to)}</text>`:''}</svg>`);
 return out.join('');
}
