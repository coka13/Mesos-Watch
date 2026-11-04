// Prepares a region crop for Tesseract. Game text is ~7px tall and often blurred by display scaling: a smooth (bicubic)
// upscale keeps letter shapes that nearest-neighbour blocks and a fixed threshold break apart ("258,809" read as "246,309").
// Pure JS on RGBA pixels, so the browser and the Node tests produce identical images.
const cubic=t=>{t=Math.abs(t);return t<1?1.5*t**3-2.5*t**2+1:t<2?-.5*t**3+2.5*t**2-4*t+2:0;};  // Keys, a=-0.5
function resample(src,len,stride,count,k){
 // One axis at a time: `count` lines of `len` samples, `stride` apart in `src`; output lines are len*k long.
 const out=new Float32Array(len*k*count),n=len*k;
 for(let o=0;o<n;o++){const s=(o+.5)/k-.5,i=Math.floor(s),w=[0,1,2,3].map(j=>cubic(s-(i-1+j))),idx=[0,1,2,3].map(j=>Math.min(len-1,Math.max(0,i-1+j)));
  for(let c=0;c<count;c++){let v=0;for(let j=0;j<4;j++)v+=w[j]*src[c*(stride===1?len:1)+idx[j]*stride];out[c*n+o]=v;}}
 return out;
}
// Grayscale, upscaled by `scale`. Returns {gray:Float32Array,width,height}.
export function upscaleGray({data,width,height},scale){
 const g=new Float32Array(width*height);for(let p=0,i=0;i<g.length;i++,p+=4)g[i]=.299*data[p]+.587*data[p+1]+.114*data[p+2];
 const rows=resample(g,width,1,height,scale),W=width*scale;           // height rows of W
 const cols=resample(rows,height,W,W,scale),H=height*scale;           // W columns of H (column-major)
 const gray=new Float32Array(W*H);for(let x=0;x<W;x++)for(let y=0;y<H;y++)gray[y*W+x]=Math.max(0,Math.min(255,cols[x*H+y]));
 return{gray,width:W,height:H};
}
// Otsu's threshold: the gray level that best separates ink from background in this crop.
export function otsu(gray){
 const h=new Array(256).fill(0);for(const v of gray)h[Math.round(v)]++;
 let sum=0;for(let i=0;i<256;i++)sum+=i*h[i];
 let sB=0,wB=0,best=-1,t=128;
 for(let i=0;i<256;i++){wB+=h[i];if(!wB)continue;const wF=gray.length-wB;if(!wF)break;sB+=i*h[i];const v=wB*wF*(sB/wB-(sum-sB)/wF)**2;if(v>best){best=v;t=i;}}
 return t;
}
// RGBA image for OCR: upscaled, optionally binarized, inside a white margin (Tesseract misses text touching the edge).
// Light text on a darker background (the minimap's white title on blue) is inverted: the more common tone is the background.
// levels [lo,hi] stretches that gray range to full contrast first (the faint gray text of sold store rows).
export function ocrImage(pixels,{scale=6,binarize=false,margin=20,levels=null}={}){
 const {gray,width,height}=upscaleGray(pixels,scale);
 if(levels){const [lo,hi]=levels;for(let i=0;i<gray.length;i++)gray[i]=Math.max(0,Math.min(255,(gray[i]-lo)*255/(hi-lo)));}
 const t=otsu(gray);
 let dark=0;for(const v of gray)if(v<=t)dark++;
 const invert=dark>gray.length/2;
 const W=width+2*margin,H=height+2*margin,data=new Uint8ClampedArray(W*H*4).fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const g=gray[y*width+x],v=invert?255-g:g,o=((y+margin)*W+x+margin)*4;data[o]=data[o+1]=data[o+2]=binarize?((invert?g>t:g<=t)?0:255):v;}
 return{data,width:W,height:H};
}
// The readings each OCR'd region gets. Two that agree are trusted; three give a tie-breaker.
export const TEXT_PASSES=[{scale:6},{scale:6,binarize:true},{scale:3}];
export const NUMBER_PASSES=[{scale:6},{scale:6,binarize:true},{scale:4,binarize:true}];
