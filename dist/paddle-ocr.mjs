// PP-OCRv5 text detection + Korean line recognition (Apache 2.0) through onnxruntime.
// Inputs are ImageData-like objects: {data:RGBA bytes,width,height}.
const REC_HEIGHT=48,MAX_REC_WIDTH=1280;
const MEAN=[0.485,0.456,0.406],STD=[0.229,0.224,0.225];

export function cropPixels(src,x0,y0,x1,y1){
 x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));
 x1=Math.min(src.width,Math.ceil(x1));y1=Math.min(src.height,Math.ceil(y1));
 const width=Math.max(1,x1-x0),height=Math.max(1,y1-y0),data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)data.set(src.data.subarray(((y0+y)*src.width+x0)*4,((y0+y)*src.width+x0+width)*4),y*width*4);
 return {data,width,height};
}

function recTensor(ort,{data,width,height}){
 const w=Math.min(MAX_REC_WIDTH,Math.max(REC_HEIGHT,Math.round(width*REC_HEIGHT/height)));
 const input=new Float32Array(3*REC_HEIGHT*w),plane=REC_HEIGHT*w;
 for(let y=0;y<REC_HEIGHT;y++){
  const sy=Math.min(height-1,Math.floor((y+.5)*height/REC_HEIGHT));
  for(let x=0;x<w;x++){
   const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),s=(sy*width+sx)*4,d=y*w+x;
   input[d]=data[s+2]/127.5-1;
   input[plane+d]=data[s+1]/127.5-1;
   input[plane*2+d]=data[s]/127.5-1;
  }
 }
 return new ort.Tensor('float32',input,[1,3,REC_HEIGHT,w]);
}

function detTensor(ort,{data,width,height},limit){
 const ratio=Math.min(1,limit/Math.max(width,height));
 const w=Math.max(32,Math.round(width*ratio/32)*32),h=Math.max(32,Math.round(height*ratio/32)*32);
 const input=new Float32Array(3*w*h),plane=w*h;
 for(let y=0;y<h;y++){
  const sy=Math.min(height-1,Math.floor((y+.5)*height/h));
  for(let x=0;x<w;x++){
   const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),s=(sy*width+sx)*4,d=y*w+x;
   input[d]=(data[s+2]/255-MEAN[0])/STD[0];
   input[plane+d]=(data[s+1]/255-MEAN[1])/STD[1];
   input[plane*2+d]=(data[s]/255-MEAN[2])/STD[2];
  }
 }
 return {tensor:new ort.Tensor('float32',input,[1,3,h,w]),sx:width/w,sy:height/h};
}

// DB post-processing: connected regions of the probability map, expanded back
// to full glyph size (the map marks a shrunk text kernel).
function boxesFrom(map,w,h,sx,sy,threshold=0.3,boxThreshold=0.5){
 const seen=new Uint8Array(w*h),boxes=[],stack=[];
 for(let start=0;start<w*h;start++){
  if(seen[start]||map[start]<threshold)continue;
  let x0=w,y0=h,x1=0,y1=0,sum=0,n=0;
  stack.push(start);seen[start]=1;
  while(stack.length){
   const i=stack.pop(),x=i%w,y=(i-x)/w;
   sum+=map[i];n++;
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(const j of [i-1,i+1,i-w,i+w]){
    if(j<0||j>=w*h||seen[j]||map[j]<threshold)continue;
    if((j===i-1&&x===0)||(j===i+1&&x===w-1))continue;
    seen[j]=1;stack.push(j);
   }
  }
  const bw=x1-x0+1,bh=y1-y0+1;
  if(n<6||bh<3||sum/n<boxThreshold)continue;
  const grow=bw*bh*1.5/(2*(bw+bh));
  boxes.push({x0:(x0-grow)*sx,y0:(y0-grow)*sy,x1:(x1+1+grow)*sx,y1:(y1+1+grow)*sy,score:sum/n});
 }
 return boxes;
}

function decode(output,dict){
 const [,steps,classes]=output.dims,values=output.data;
 let text='',last=0,score=0,count=0;
 const frames=[];
 for(let t=0;t<steps;t++){
  let best=0,bestValue=-Infinity;
  for(let c=0;c<classes;c++){const v=values[t*classes+c];if(v>bestValue){bestValue=v;best=c;}}
  if(best!==0&&best!==last){
   const ch=best<=dict.length?dict[best-1]:' ';
   text+=ch;frames.push({t,ch});
   score+=bestValue;count++;
  }
  last=best;
 }
 return {text,score:count?score/count:0,frames,steps};
}

export async function createPaddleReader({ort,detModel,recModel,dictText}){
 const dict=dictText.split(/\r?\n/);
 while(dict.length&&dict[dict.length-1]==='')dict.pop();
 const [det,rec]=await Promise.all([ort.InferenceSession.create(detModel),ort.InferenceSession.create(recModel)]);
 const recognize=async pixels=>{
  if(!pixels?.width||!pixels?.height)return {text:'',score:0,frames:[],steps:0};
  const result=await rec.run({[rec.inputNames[0]]:recTensor(ort,pixels)});
  const output=result[rec.outputNames[0]];
  return decode(output,dict);
 };
 return {
  async detect(pixels,limit=1600){
   const {tensor,sx,sy}=detTensor(ort,pixels,limit);
   const result=await det.run({[det.inputNames[0]]:tensor});
   const out=result[det.outputNames[0]],[, ,h,w]=out.dims;
   return boxesFrom(out.data,w,h,sx,sy);
  },
  recognize
 };
}
