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

function blank(makeCanvas,width,height){const canvas=makeCanvas();canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));return canvas;}

function labelBand(data,width,height){
 const rows=[];
 for(let y=0;y<height;y++){
  let white=0,blue=0,pink=0,edge=0,n=0;
  for(let x=1;x<width;x+=2){
   const i=(y*width+x)*4,p=(y*width+x-1)*4,r=data[i],g=data[i+1],b=data[i+2],v=(r+g+b)/3;
   n++;
   if(v>185&&Math.max(r,g,b)-Math.min(r,g,b)<40)white++;
   if(b>80&&b>r+25&&b>g+8)blue++;
   if(r>150&&r>g+30&&r>b+15)pink++;
   if(Math.abs(r-data[p])+Math.abs(g-data[p+1])+Math.abs(b-data[p+2])>80)edge++;
  }
  rows.push({white:white/n,blue:blue/n,pink:pink/n,edge:edge/n});
 }
 let bluePeak=0,blueAt=height;
 for(let y=0;y<height;y++)if(rows[y].blue>bluePeak){bluePeak=rows[y].blue;blueAt=y;}
 const searchBottom=bluePeak>0.12?Math.max(12,blueAt-8):Math.round(height*.78);
 const searchTop=Math.round(height*.22);
 let peak=0,at=Math.round((searchTop+searchBottom)/2);
 for(let y=searchTop;y<searchBottom;y++)if(rows[y].white>0.25&&rows[y].pink<0.08&&rows[y].edge>peak){peak=rows[y].edge;at=y;}
 return [Math.max(0,at-38),Math.min(searchBottom,at+42)];
}

function shelfSpans(data,width,y0,y1){
 const mean=new Float64Array(width);
 for(let x=0;x<width;x++){
  let sum=0,n=0;
  for(let y=y0;y<y1;y++){const i=(y*width+x)*4;sum+=data[i]*.299+data[i+1]*.587+data[i+2]*.114;n++;}
  mean[x]=sum/Math.max(1,n);
 }
 const smooth=mean.map((_,x)=>{let sum=0,n=0;for(let k=-4;k<=4;k++){const i=x+k;if(i<0||i>=width)continue;sum+=mean[i];n++;}return sum/n;});
 let left=0,right=width-1;
 while(left<right&&smooth[left]<100)left++;
 while(right>left&&smooth[right]<100)right--;
 const gaps=[];
 for(let x=left+12;x<right-12;x++){
  if(smooth[x]>smooth[x-1]||smooth[x]>smooth[x+1]||smooth[x]>120)continue;
  let side=0;
  for(let k=8;k<=36;k++)side=Math.max(side,smooth[Math.max(left,x-k)],smooth[Math.min(right,x+k)]);
  if(side-smooth[x]>48)gaps.push(x);
 }
 const centers=[];
 for(const x of gaps){const last=centers[centers.length-1];if(!last||x-last.at>14)centers.push({at:x,dark:smooth[x]});else if(smooth[x]<last.dark)last.at=x,last.dark=smooth[x];}
 const bounds=[left,...centers.map(g=>g.at),right];
 const spans=[];
 for(let i=0;i<bounds.length-1;i++)if(bounds[i+1]-bounds[i]>=26)spans.push([bounds[i],bounds[i+1]]);
 return spans;
}

function adaptiveTrim(source,x0,y0,x1,y1,makeCanvas){
 const sw=Math.max(1,x1-x0),sh=Math.max(1,y1-y0),scale=Math.min(4,Math.max(3,180/sh));
 const canvas=blank(makeCanvas,sw*scale,sh*scale),ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(source,x0,y0,sw,sh,0,0,canvas.width,canvas.height);
 const image=ctx.getImageData(0,0,canvas.width,canvas.height),{data,width,height}=image,gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);
 for(let x=0;x<width;x++){
  let dark=0;for(let y=0;y<height;y++)if(gray[y*width+x]<70)dark++;
  if(dark/height>.72)for(let y=0;y<height;y++)gray[y*width+x]=255;
 }
 const integral=new Float64Array((width+1)*(height+1)),radius=14,bias=8;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)integral[(y+1)*(width+1)+x+1]=gray[y*width+x]+integral[y*(width+1)+x+1]+integral[(y+1)*(width+1)+x]-integral[y*(width+1)+x];
 let minX=width,minY=height,maxX=0,maxY=0,ink=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const xa=Math.max(0,x-radius),xb=Math.min(width-1,x+radius),ya=Math.max(0,y-radius),yb=Math.min(height-1,y+radius);
  const area=(xb-xa+1)*(yb-ya+1),sum=integral[(yb+1)*(width+1)+xb+1]-integral[ya*(width+1)+xb+1]-integral[(yb+1)*(width+1)+xa]+integral[ya*(width+1)+xa];
  const on=gray[y*width+x]<sum/area-bias;
  data[(y*width+x)*4]=data[(y*width+x)*4+1]=data[(y*width+x)*4+2]=on?0:255;
 }
 for(let x=0;x<width;x++){
  let dark=0;for(let y=0;y<height;y++)if(data[(y*width+x)*4]===0)dark++;
  if(dark/height>.5)for(let y=0;y<height;y++)data[(y*width+x)*4]=data[(y*width+x)*4+1]=data[(y*width+x)*4+2]=255;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4]===0){ink++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 if(ink<40||maxX<=minX)return '';
 const pad=24,out=blank(makeCanvas,maxX-minX+1+pad*2,maxY-minY+1+pad*2),octx=out.getContext('2d');
 octx.fillStyle='white';octx.fillRect(0,0,out.width,out.height);
 const dest=octx.getImageData(0,0,out.width,out.height);
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const s=(y*width+x)*4,d=((y-minY+pad)*out.width+(x-minX+pad))*4;
  dest.data[d]=data[s];dest.data[d+1]=data[s+1];dest.data[d+2]=data[s+2];dest.data[d+3]=255;
 }
 octx.putImageData(dest,0,0);
 const url=out.toDataURL('image/png');
 if(!url.startsWith('data:image'))return '';
 const rowInk=[];
 for(let y=0;y<out.height;y++){let n=0;for(let x=0;x<out.width;x++)if(dest.data[(y*out.width+x)*4]<40)n++;rowInk.push(n);}
 const peak=Math.max(...rowInk,1),rows=[];
 for(let y=0;y<out.height;y++)if(rowInk[y]>peak*.25)rows.push(y);
 const cuts=[];
 let start=rows[0];
 for(let i=1;i<=rows.length;i++)if(rows.length&&(i===rows.length||rows[i]>rows[i-1]+3)){if(rows[i-1]-start>6)cuts.push([start,rows[i-1]]);start=rows[i];}
 const lines=cuts.slice(0,2).map(([a,b])=>{
  const linePad=16,line=blank(makeCanvas,out.width,b-a+1+linePad*2),lctx=line.getContext('2d');
  lctx.fillStyle='white';lctx.fillRect(0,0,line.width,line.height);
  lctx.drawImage(out,0,a,out.width,b-a+1,0,linePad,out.width,b-a+1);
  return line.toDataURL('image/png');
 });
 return {image:url,lines};
}

// Separate each spine at the shadow between books, then flatten uneven light.
export function analyzeShelf(source,makeCanvas=()=>document.createElement('canvas')){
 const width=source.width,height=source.height;
 if(!width||!height)return {band:null,strips:[]};
 const probe=blank(makeCanvas,width,height),pctx=probe.getContext('2d',{willReadFrequently:true});
 pctx.drawImage(source,0,0,width,height);
 const {data}=pctx.getImageData(0,0,width,height);
 const [y0,y1]=labelBand(data,width,height),spans=shelfSpans(data,width,y0,y1);
 if(spans.length<2)return {band:null,strips:[]};
 const scale=3,x0=spans[0][0],x1=spans[spans.length-1][1],bw=x1-x0;
 const band=blank(makeCanvas,bw*scale,(y1-y0)*scale),bctx=band.getContext('2d',{willReadFrequently:true});
 bctx.fillStyle='white';bctx.fillRect(0,0,band.width,band.height);
 bctx.drawImage(source,x0,y0,bw,y1-y0,0,0,band.width,band.height);
 const pixels=bctx.getImageData(0,0,band.width,band.height),hist=new Uint32Array(256),gray=new Uint8Array(pixels.data.length/4);
 for(let i=0;i<gray.length;i++){gray[i]=Math.round(pixels.data[i*4]*.299+pixels.data[i*4+1]*.587+pixels.data[i*4+2]*.114);hist[gray[i]]++;}
 let low=0,high=255,sum=0;while(low<250&&(sum+=hist[low])<gray.length*.02)low++;
 sum=0;while(high>low&&(sum+=hist[high])<gray.length*.02)high--;
 for(let i=0;i<gray.length;i++){const value=Math.max(0,Math.min(255,(gray[i]-low)*255/Math.max(12,high-low)));pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=value;}
 bctx.putImageData(pixels,0,0);
 const strips=[];
 for(const [x0,x1] of spans){
  const trimmed=adaptiveTrim(source,x0,y0,x1,y1,makeCanvas);
  if(trimmed?.image)strips.push({image:trimmed.image,lines:trimmed.lines||[],bbox:[x0,y0,x1,y1]});
 }
 return {band:{image:band.toDataURL('image/png'),mapWord:word=>({...word,bbox:{x0:word.bbox.x0/scale+x0,x1:word.bbox.x1/scale+x0,y0:word.bbox.y0/scale+y0,y1:word.bbox.y1/scale+y0}})},strips};
}
