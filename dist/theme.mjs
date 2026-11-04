// Light / dark mode. The inline script in index.html applies the saved choice before first paint;
// this wires up the header toggle and follows the system preference until the user picks one.
const KEY='mesoswatch:theme';
const root=document.documentElement;
const system=matchMedia('(prefers-color-scheme: dark)');
const button=document.getElementById('theme-toggle');
const meta=document.querySelector('meta[name="theme-color"]');

function saved(){try{const v=localStorage.getItem(KEY);return v==='dark'||v==='light'?v:null;}catch{return null;}}
function apply(theme){
 root.dataset.theme=theme;
 if(meta)meta.content=theme==='dark'?'#0d1730':'#85c5e6';
 if(button){
  const dark=theme==='dark';
  button.setAttribute('aria-checked',String(dark));
  button.title=dark?'Switch to light mode':'Switch to dark mode';
 }
}
apply(saved()||(system.matches?'dark':'light'));
system.addEventListener('change',event=>{if(!saved())apply(event.matches?'dark':'light');});
button?.addEventListener('click',()=>{
 const next=root.dataset.theme==='dark'?'light':'dark';
 try{localStorage.setItem(KEY,next);}catch{}
 apply(next);
});
