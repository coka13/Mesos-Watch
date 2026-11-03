// Small decorative effects. Purely visual: nothing here reads or changes data. All motion is CSS, so
// prefers-reduced-motion (handled in site.css) turns it off, and offscreen or hidden-tab decorations are paused.
const $=id=>document.getElementById(id);
const replay=(node,cls)=>{node.classList.remove(cls);void node.offsetWidth;node.classList.add(cls);};

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
