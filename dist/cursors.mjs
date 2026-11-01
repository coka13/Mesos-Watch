// MapleStory cursors (github.com/zaytri/maplestory-cursors). Browsers can't play .ani files,
// so the frames live in cursors/ as PNGs and we flip a CSS variable per frame.
const CURSORS={
  arrow:{file:'point',hot:[0,0],ms:[0],fallback:'default'},
  pointer:{file:'point_click',hot:[3,6],ms:[500,500],fallback:'pointer'},
  lock:{file:'point_lock',hot:[0,3],ms:[500,500],fallback:'not-allowed'},
};
const root=document.documentElement.style;
const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(matchMedia('(any-hover: hover)').matches)for(const[name,c]of Object.entries(CURSORS)){
  const values=c.ms.map((_,i)=>{const url=new URL(`cursors/${c.file}-${i}.png`,import.meta.url).href;new Image().src=url;return `url("${url}") ${c.hot[0]} ${c.hot[1]}, ${c.fallback}`;});
  let i=0;const tick=()=>{root.setProperty('--mc-'+name,values[i]);if(still||values.length<2)return;setTimeout(()=>{i=(i+1)%values.length;tick();},c.ms[i]);};
  tick();
}
