// Shared by the browser and the local photo benchmark.
export function prepareLine(source,book,part,analysisWidth,makeCanvas=()=>document.createElement('canvas'),variant=0){
 const [x,y,r,b]=book.labelBox,h=b-y,ratio=source.width/analysisWidth;
 const top=part==='number'?y-h*.2:b+h*.05;
 const bottom=part==='number'?b+h*.15:b+h*1.65;
 const left=Math.max(0,(x-h*.45)*ratio),right=Math.min(source.width,(r+h*.65)*ratio);
 const sy=Math.max(0,top*ratio),ey=Math.min(source.height,bottom*ratio);
 const scale=Math.min(4,Math.max(1,90/(h*ratio))),pad=24;
 const canvas=makeCanvas();canvas.width=Math.max(1,Math.round((right-left)*scale))+pad*2;canvas.height=Math.max(1,Math.round((ey-sy)*scale))+pad*2;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(source,left,sy,right-left,ey-sy,pad,pad,canvas.width-pad*2,canvas.height-pad*2);
 const image=ctx.getImageData(pad,pad,canvas.width-pad*2,canvas.height-pad*2),hist=new Uint32Array(256),gray=new Uint8Array(image.data.length/4);
 for(let i=0;i<gray.length;i++){gray[i]=Math.round(.299*image.data[i*4]+.587*image.data[i*4+1]+.114*image.data[i*4+2]);hist[gray[i]]++;}
 let low=0,high=255,sum=0;while(low<254&&(sum+=hist[low])<gray.length*.01)low++;
 sum=0;while(high>low&&(sum+=hist[high])<gray.length*.01)high--;
 for(let i=0;i<gray.length;i++){let value=Math.max(0,Math.min(255,(gray[i]-low)*255/Math.max(1,high-low)));if(variant)value=value<145?0:255;image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=value;}
 ctx.putImageData(image,pad,pad);return canvas.toDataURL('image/png');
}

export async function improveCameraFocus(track){
 const caps=track.getCapabilities?.()||{},advanced={};
 if(caps.focusMode?.includes('continuous'))advanced.focusMode='continuous';
 if(caps.exposureMode?.includes('continuous'))advanced.exposureMode='continuous';
 if(caps.whiteBalanceMode?.includes('continuous'))advanced.whiteBalanceMode='continuous';
 if(Object.keys(advanced).length)try{await track.applyConstraints({advanced:[advanced]});}catch{/* Unsupported optional controls must never stop the camera. */}
}

export function detectionTiles(source,analysisWidth,makeCanvas=()=>document.createElement('canvas')){
 const tiles=[],ratio=analysisWidth/source.width;
 // Overlap protects labels crossing a tile boundary. Only used after the
 // quick full-scene search fails, avoiding this cost on ordinary frames.
 for(const xFraction of [0,.4]){
  const x=source.width*xFraction,w=source.width*.6,scale=Math.min(2,2200/w);
  const canvas=makeCanvas();canvas.width=Math.round(w*scale);canvas.height=Math.round(source.height*scale);
  canvas.getContext('2d').drawImage(source,x,0,w,source.height,0,0,canvas.width,canvas.height);
  tiles.push({image:canvas.toDataURL('image/png'),mapWord:word=>({...word,bbox:{x0:(word.bbox.x0/scale+x)*ratio,x1:(word.bbox.x1/scale+x)*ratio,y0:word.bbox.y0/scale*ratio,y1:word.bbox.y1/scale*ratio}})});
 }
 return tiles;
}
