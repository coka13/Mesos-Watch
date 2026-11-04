// Which shop is on screen, across reads (pure: no DOM). OCR reads a shop's title differently from one look to the next
// ("LeoTsuwubasal", "Clac e", or nothing), and the title is part of the shop key, so each misread would publish the same
// listings again as another shop. A shop read at the same place whose rows overlap a shop seen there recently is that shop:
// it keeps the title read most often (the first one on a tie), and an unread title takes it too.
//   const shops=createShopMemory(); shops.resolve(placeKey, title, listingKeys) -> the title to publish under
export function createShopMemory({ttl=30*60e3,max=200}={}){
 const shops=[];
 const canonical=s=>[...s.titles].sort((a,b)=>b[1].n-a[1].n||a[1].first-b[1].first)[0]?.[0]||'';
 return{
  resolve(place,title,keys,now=Date.now()){
   const set=new Set(keys),t=String(title||'').trim();
   if(!set.size)return t;
   let best=null,overlap=0;
   for(const s of shops){
    if(s.place!==place||now-s.at>ttl)continue;
    let n=0;for(const k of set)if(s.keys.has(k))n++;
    if(n>overlap){best=s;overlap=n;}
   }
   // Two shared rows, or every row of a one-row shop; and at least half of the smaller shop.
   const smaller=best?Math.min(set.size,best.keys.size):0;
   if(best&&overlap>=Math.min(2,smaller)&&overlap*2>=smaller){
    for(const k of set)best.keys.add(k);
    if(t){const c=best.titles.get(t);best.titles.set(t,{n:(c?.n||0)+1,first:c?.first??now});}
    best.at=now;
    return canonical(best)||t;
   }
   shops.push({place,keys:set,titles:new Map(t?[[t,{n:1,first:now}]]:[]),at:now});
   if(shops.length>max)shops.shift();
   return t;
  },
  clear(){shops.length=0;},
 };
}
