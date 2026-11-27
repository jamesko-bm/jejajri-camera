// Shape match for the single jamo printed after a cutter number (신68ㅇ, 스831ㄷ).
// Templates are rendered from Noto Sans KR (SIL OFL) by make-jamo-templates.mjs.
export const GRID=24;
export const SHAPES='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ0123456789';

function otsu(gray){
 const hist=new Float64Array(256);for(const v of gray)hist[v]++;
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
 let sumB=0,wB=0,best=0,threshold=128;
 for(let t=0;t<256;t++){
  wB+=hist[t];if(!wB)continue;const wF=gray.length-wB;if(!wF)break;
  sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)**2;
  if(between>best){best=between;threshold=t;}
 }
 return threshold;
}

export function inkMask({data,width,height}){
 const gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);
 const t=otsu(gray),ink=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++)ink[i]=gray[i]<t?1:0;
 return {ink,width,height};
}

// Ink inside [x0,x1) split into connected parts; parts touching the top or
// bottom edge are strokes of the neighbouring text line and are dropped.
function glyphPixels(mask,x0,x1,band=null){
 const {ink,width,height}=mask,seen=new Uint8Array(width*height),parts=[];
 for(let y=0;y<height;y++)for(let x=x0;x<x1;x++){
  const s=y*width+x;if(!ink[s]||seen[s])continue;
  const stack=[s],pixels=[];seen[s]=1;let edge=false;
  while(stack.length){
   const i=stack.pop(),px=i%width,py=(i-px)/width;pixels.push(i);
   if(py===0||py===height-1)edge=true;
   for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=px+dx,ny=py+dy;if(nx<x0||nx>=x1||ny<0||ny>=height)continue;
    const j=ny*width+nx;if(ink[j]&&!seen[j]){seen[j]=1;stack.push(j);}
   }
  }
  let top=height,bottom=0,left=width,right=0;
  for(const i of pixels){const px=i%width,py=(i-px)/width;if(py<top)top=py;if(py>bottom)bottom=py;if(px<left)left=px;if(px>right)right=px;}
  const outside=band&&((top+bottom)/2<band[0]||(top+bottom)/2>band[1]);
  parts.push({pixels,edge:edge||outside,top,bottom,left,right});
 }
 let inner=parts.filter(p=>!p.edge&&p.pixels.length>=3);
 const main=inner.reduce((p,q)=>!p||q.pixels.length>p.pixels.length?q:p,null);
 // The marks above ㅊ and ㅎ sit centred; small specks off to the side above or
 // below the main stroke are dirt.
 inner=inner.filter(p=>{
  if(p===main)return true;
  if(p.pixels.length<main.pixels.length*.04)return false;
  if(p.pixels.length>=main.pixels.length*.15||(p.bottom>=main.top&&p.top<=main.bottom))return true;
  const cx=(p.left+p.right)/2,mw=main.right-main.left;
  return cx>=main.left+mw*.2&&cx<=main.right-mw*.2;
 });
 return trimEdgeLines((inner.length?inner:parts).flatMap(p=>p.pixels),width);
}

// A one-pixel book edge touching the glyph sticks out above or below the
// glyph's other columns; cut those rows from the outermost columns.
function trimEdgeLines(pixels,width){
 if(pixels.length<20)return pixels;
 const xs=pixels.map(i=>i%width),left=Math.min(...xs),right=Math.max(...xs);
 if(right-left<6)return pixels;
 let out=pixels;
 for(let pass=0;pass<2;pass++){
  const px=out.map(i=>i%width),lo=Math.min(...px),hi=Math.max(...px);
  let top=Infinity,bottom=-1;
  out.forEach((i,n)=>{if(px[n]>lo&&px[n]<hi){const y=(i-px[n])/width;if(y<top)top=y;if(y>bottom)bottom=y;}});
  if(bottom<top)break;
  const slack=Math.max(1,(bottom-top)*.15);
  const next=out.filter((i,n)=>{if(px[n]!==lo&&px[n]!==hi)return true;const y=(i-px[n])/width;return y>=top-slack&&y<=bottom+slack;});
  if(next.length===out.length)break;
  out=next;
 }
 return out;
}

// Normalise a glyph's ink box into a GRID×GRID field (stretched to fill).
// band: [top,bottom] rows of the text line; ink centred outside it is ignored.
export function glyphVector(mask,x0,x1,band=null){
 const {ink,width}=mask,pixels=glyphPixels(mask,x0,x1,band);
 if(!pixels.length)return null;
 let gx0=Infinity,gx1=-1,gy0=Infinity,gy1=-1;
 for(const i of pixels){const x=i%width,y=(i-x)/width;if(x<gx0)gx0=x;if(x>gx1)gx1=x;if(y<gy0)gy0=y;if(y>gy1)gy1=y;}
 const w=gx1-gx0+1,h=gy1-gy0+1;
 const on=new Uint8Array(w*h);for(const i of pixels){const x=i%width,y=(i-x)/width;on[(y-gy0)*w+x-gx0]=1;}
 const field=new Float32Array(GRID*GRID);
 for(let cy=0;cy<GRID;cy++){
  const ya=Math.floor(cy*h/GRID),yb=Math.max(ya+1,Math.ceil((cy+1)*h/GRID));
  for(let cx=0;cx<GRID;cx++){
   const xa=Math.floor(cx*w/GRID),xb=Math.max(xa+1,Math.ceil((cx+1)*w/GRID));
   let s=0,n=0;for(let y=ya;y<yb&&y<h;y++)for(let x=xa;x<xb&&x<w;x++){s+=on[y*w+x];n++;}
   field[cy*GRID+cx]=n?s/n:0;
  }
 }
 return {field:blur(field),aspect:w/h,width:w,height:h,box:[gx0,gy0,gx1,gy1]};
}

function blur(f){
 const out=new Float32Array(f.length);
 for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){
  let s=0,n=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=GRID||xx>=GRID)continue;const k=dx||dy?1:2;s+=f[yy*GRID+xx]*k;n+=k;}
  out[y*GRID+x]=s/n;
 }
 return out;
}

// Template fields are stored as one digit (0-9) per grid cell.
export function loadTemplates(json){
 const out={};
 for(const [ch,list] of Object.entries(json))out[ch]=list.map(t=>({...t,field:typeof t.field==='string'?Float32Array.from(t.field,c=>Number(c)/9):Float32Array.from(t.field)}));
 return out;
}

// digitHeight: printed height of a digit on the same line, so a glyph's width
// can tell double consonants (ㄲ, ㄸ) from single ones.
export function classify(glyph,templates,allowed=SHAPES,digitHeight=0){
 if(!glyph)return {ch:'',distance:Infinity};
 let best='',bestD=Infinity,second=Infinity;
 const rel=digitHeight?glyph.width/digitHeight:0;
 for(const ch of allowed){
  for(const t of templates[ch]||[]){
   let d=0;
   for(let i=0;i<glyph.field.length;i++){const e=glyph.field[i]-t.field[i];d+=e*e;}
   d=Math.sqrt(d/glyph.field.length)+Math.abs(Math.log(glyph.aspect/t.aspect))*0.06;
   if(rel&&t.rel)d+=Math.abs(Math.log(rel/t.rel))*0.25;
   if(d<bestD){if(ch!==best)second=bestD;bestD=d;best=ch;}
   else if(d<second&&ch!==best)second=d;
  }
 }
 return {ch:best,distance:bestD,margin:second-bestD};
}

// Columns of ink split into glyph clusters; a gap is a run of empty columns.
export function columnClusters(mask,minGap=1){
 const {ink,width,height}=mask,cols=new Uint16Array(width);
 for(let x=0;x<width;x++){let n=0;for(let y=0;y<height;y++)n+=ink[y*width+x];cols[x]=n;}
 const clusters=[];let start=-1,empty=0;
 for(let x=0;x<=width;x++){
  const on=x<width&&cols[x]>0;
  if(on){if(start<0)start=x;empty=0;}
  else if(start>=0){empty++;if(empty>=minGap||x===width){clusters.push([start,x-empty+1]);start=-1;empty=0;}}
 }
 return clusters;
}
