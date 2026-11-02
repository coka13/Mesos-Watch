// Find grayscale digit ink inside a selected balance field. Ignore long borders and colored overlays.
export function numericInkBounds({data,width,height},scale=1){
 const dark=(x,y)=>{const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2];return Math.max(r,g,b)-Math.min(r,g,b)<45&&.299*r+.587*g+.114*b<140;};
 const rows=[];let current=[],best=[];
 for(let y=0;y<height;y++){let count=0;for(let x=0;x<width;x++)if(dark(x,y))count++;const valid=count>=Math.max(2,scale)&&count<width*.65;if(valid){current.push(y);if(current.length>best.length)best=[...current];}else current=[];rows.push(count);}
 if(best.length<3*scale)return null;
 let left=width,right=-1;
 for(let x=0;x<width;x++){let column=0,ink=0;for(let y=0;y<height;y++)if(dark(x,y))column++;for(const y of best)if(dark(x,y))ink++;if(ink&&column<height*.8){left=Math.min(left,x);right=Math.max(right,x);}}
 if(right-left<2*scale)return null;
 const pad=Math.max(1,Math.round(scale)),x=Math.max(0,left-pad),y=Math.max(0,best[0]-pad);
 return{x,y,w:Math.min(width,right+pad+1)-x,h:Math.min(height,best.at(-1)+pad+1)-y};
}
