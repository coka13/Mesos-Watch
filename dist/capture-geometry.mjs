export function sourcePoint(point,preview,source){
 if(![point.x,point.y,preview.x,preview.y,preview.width,preview.height,source.width,source.height].every(Number.isFinite)||preview.width<=0||preview.height<=0||source.width<=0||source.height<=0)throw Error('Capture dimensions are not ready.');
 return{x:Math.max(0,Math.min(source.width,(point.x-preview.x)*source.width/preview.width)),y:Math.max(0,Math.min(source.height,(point.y-preview.y)*source.height/preview.height))};
}
export function validRegion(r,width,height){return !!r&&[r.x,r.y,r.w,r.h,width,height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=width&&r.y+r.h<=height;}
// Source-pixel region to preview coordinates: the inverse of sourcePoint, for drawing detection boxes over a scaled preview.
export function previewRect(r,preview,source){
 if(![r?.x,r?.y,r?.w,r?.h,preview.x,preview.y,preview.width,preview.height,source.width,source.height].every(Number.isFinite)||preview.width<=0||preview.height<=0||source.width<=0||source.height<=0)throw Error('Capture dimensions are not ready.');
 const sx=preview.width/source.width,sy=preview.height/source.height;
 return{x:preview.x+r.x*sx,y:preview.y+r.y*sy,w:r.w*sx,h:r.h*sy};
}
