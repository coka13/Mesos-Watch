// Small decorative effects. Purely visual: nothing here reads or changes data. All motion is CSS, so
// prefers-reduced-motion (handled in site.css) turns it off, and offscreen or hidden-tab decorations are paused.
const $=id=>document.getElementById(id);
const replay=(node,cls)=>{node.classList.remove(cls);void node.offsetWidth;node.classList.add(cls);};

// Falling maple leaves behind the page: the in-game Maple Leaf and Golden Maple Leaf icons, at 1x or exactly 0.5x so their pixels stay
// crisp. Each drifts on its own path. Only transforms move, so the browser never repaints the page for them.
const sky=document.querySelector('.sky');
if(sky&&!sky.querySelector('.maple-fall')){
 const layer=document.createElement('div');layer.className='maple-fall';
 for(const [x,size,seconds,delay,sway,spin,gold,rest] of [[6,28,27,-3,46,190,0,18],[18,14,21,-16,28,-260,0,62],[31,29,31,-9,52,160,1,34],[44,14,24,-20,30,240,0,78],[57,28,29,-13,44,-180,0,24],[69,14,20,-6,26,280,1,52],[82,28,33,-24,50,170,0,70],[93,14,23,-11,32,-230,0,40]]){
  const leaf=document.createElement('i');leaf.className=gold?'gold':'';
  for(const [k,v] of Object.entries({'--x':x+'%','--s':size+'px','--d':seconds+'s','--delay':delay+'s','--sway':sway+'px','--spin':spin+'deg','--rest':rest+'%'}))leaf.style.setProperty(k,v);
  layer.append(leaf);
 }
 sky.append(layer);
}

// Pause the hero parade while it is scrolled out of view.
const parade=document.querySelector('.mob-parade');
if(parade&&'IntersectionObserver' in window)new IntersectionObserver(es=>{for(const e of es)e.target.classList.toggle('offscreen',!e.isIntersecting);}).observe(parade);

// Mesos sparkle when the profit calculator produces a new result.
const trade=$('trade-output');
if(trade)new MutationObserver(()=>{if(trade.childElementCount)replay(trade,'sparkle');}).observe(trade,{childList:true});

// Megaphone messages slide in when the rotation changes.
const mega=$('mega-text');
if(mega)new MutationObserver(()=>replay(mega,'enter')).observe(mega,{childList:true,characterData:true,subtree:true});

// Watchlist additions: a slime hops up with a star.
window.addEventListener('mesoswatch:watched',e=>{
 const pop=document.createElement('div');pop.className='watch-pop';pop.setAttribute('role','status');
 const img=Object.assign(document.createElement('img'),{src:'sprites/slime.gif',alt:'',width:36,height:26});
 pop.append(img,document.createTextNode('★ '+String(e.detail?.name||'Item')+' watched'));
 document.body.append(pop);setTimeout(()=>pop.remove(),2600);
});
