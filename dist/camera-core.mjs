import {compare} from './ordering.mjs';
import {readLabels} from './labels.mjs';

// A decrease flags the preceding (left) book, as requested by the user.
export function decreasingBooks(books){
 const flagged=[],uncertain=[];
 for(let i=1;i<books.length;i++){
  const a=books[i-1],b=books[i];
  if(a.uncertain||b.uncertain){uncertain.push(i);continue;}
  if(!/^\d{3}(?:\.\d+)?$/.test(a.classification)||!/^\d{3}(?:\.\d+)?$/.test(b.classification)) {uncertain.push(i);continue;}
  let result=compare({...a,author:'',volume:'1'},{...b,author:'',volume:'1'});
  if(!result){
   if(!a.author||!b.author){uncertain.push(i);continue;}
   result=compare({...a,volume:'1'},{...b,volume:'1'});
   if(!result){
    if(Boolean(a.volume)!==Boolean(b.volume)){uncertain.push(i);continue;}
    if(a.volume&&b.volume)result=compare(a,b);
   }
  }
  if(result>0)flagged.push(a);
 }
 return {flagged,complete:books.length>=2&&uncertain.length===0,uncertain};
}

export function frameDifference(a,b){
 if(!a||!b||a.length!==b.length)return Infinity;
 // Ignore a uniform exposure shift, retain changed spatial structure.
 let offset=0;for(let i=0;i<a.length;i++)offset+=a[i]-b[i];offset/=a.length;
 let diff=0;for(let i=0;i<a.length;i++)diff+=Math.abs(a[i]-b[i]-offset);return diff/a.length;
}

export class RecognitionGate{
 constructor({settleMs=1000,threshold=7,retryMs=3000}={}){Object.assign(this,{settleMs,threshold,retryMs});this.reset();}
 reset(){this.revision=(this.revision||0)+1;this.reference=null;this.previous=null;this.lastMotion=0;this.nextTry=0;this.done=false;this.busy=this.busy||false;this.held=null;this.followUntil=0;}
 tick(signature,now){
  const moved=!this.reference||frameDifference(signature,this.previous)>this.threshold||frameDifference(signature,this.reference)>this.threshold;
  const holding=this.held!=null&&this.held===this.activeToken;
  const following=this.followUntil>now;
  if(moved&&!holding&&!following){this.revision++;this.reference=signature.slice();this.lastMotion=now;this.done=false;this.nextTry=0;this.followUntil=0;}
  else if(moved)this.reference=signature.slice();
  this.previous=signature.slice();return {moved:moved&&!holding&&!following,ready:!this.busy&&!this.done&&now-this.lastMotion>=this.settleMs&&now>=this.nextTry};
 }
 begin(){this.busy=true;this.held=null;this.followUntil=0;this.activeToken=this.revision;return this.revision;}
 freeze(){if(this.busy)this.held=this.activeToken;}
 finish(token,complete,now){this.held=null;if(token!==this.activeToken)return false;this.busy=false;this.activeToken=null;if(token!==this.revision)return false;this.done=complete;this.nextTry=now+this.retryMs;this.followUntil=complete?now+1000:0;return true;}
}

export function cameraCandidates(words,width,height){
 return readLabels(words,width,height);
}

function luma(data,i){return data[i]*.299+data[i+1]*.587+data[i+2]*.114;}

function seedBox(book){
 const box=book.labelBox?.length===4?book.labelBox:book.bbox;
 return box.map(v=>Math.round(Number(v)||0));
}

function rowProfile(data,width,y,x0,x1){
 let sum=0,sum2=0,sat=0,edge=0,n=0;
 x0=Math.max(0,Math.floor(x0));x1=Math.min(width,Math.ceil(x1));
 if(x1<=x0||y<0)return {mean:0,variance:0,sat:0,edge:0};
 for(let x=x0;x<x1;x++){
  const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],v=luma(data,i);
  sum+=v;sum2+=v*v;n++;sat+=Math.max(r,g,b)-Math.min(r,g,b);
  if(x>x0){const p=i-4;edge+=Math.abs(r-data[p])+Math.abs(g-data[p+1])+Math.abs(b-data[p+2]);}
 }
 const mean=sum/n;
 return {mean,variance:sum2/n-mean*mean,sat:sat/n,edge:edge/n};
}

function colProfile(data,width,height,x,y0,y1){
 let sum=0,sum2=0,edge=0,n=0;
 y0=Math.max(0,Math.floor(y0));y1=Math.min(height,Math.ceil(y1));
 if(y1<=y0||x<0||x>=width)return {mean:0,variance:0,edge:0};
 for(let y=y0;y<y1;y++){
  const i=(y*width+x)*4,v=luma(data,i);
  sum+=v;sum2+=v*v;n++;
  if(x>0){const p=i-4;edge+=Math.abs(data[i]-data[p])+Math.abs(data[i+1]-data[p+1])+Math.abs(data[i+2]-data[p+2]);}
 }
 const mean=sum/n;
 return {mean,variance:sum2/n-mean*mean,edge:edge/n};
}

function vertJump(data,width,y,x0,x1){
 if(y<=0)return 0;
 let d=0,n=0;
 for(let x=Math.max(0,x0);x<Math.min(width,x1);x+=2){
  const a=(y*width+x)*4,b=((y-1)*width+x)*4;
  d+=Math.abs(data[a]-data[b])+Math.abs(data[a+1]-data[b+1])+Math.abs(data[a+2]-data[b+2]);n++;
 }
 return d/Math.max(1,n);
}

function verticalEdges(data,width,y0,y1){
 const edges=new Float64Array(width);
 y0=Math.max(1,y0);y1=Math.max(y0+1,y1);
 for(let x=2;x<width-2;x++){
  let s=0;
  for(let y=y0;y<y1;y+=2){
   const a=(y*width+x-2)*4,b=(y*width+x+2)*4;
   s+=Math.abs(data[a]-data[b])+Math.abs(data[a+1]-data[b+1])+Math.abs(data[a+2]-data[b+2]);
  }
  edges[x]=s;
 }
 return edges;
}

function peakEdge(edges,from,to){
 let best=Math.round((from+to)/2),score=-1;
 const lo=Math.max(2,Math.floor(Math.min(from,to))),hi=Math.min(edges.length-2,Math.ceil(Math.max(from,to)));
 for(let x=lo;x<=hi;x++){const s=edges[x]+edges[x-1]+edges[x+1];if(s>score){score=s;best=x;}}
 return best;
}

function sameTone(a,b){return Math.abs(a.mean-b.mean)<34;}

function expandX(data,width,height,start,limit,y0,y1,dir){
 const interior=colProfile(data,width,height,start,y0,y1);
 if(interior.variance<16&&interior.edge<8&&interior.mean<22)return start;
 let x=start,last=start;
 for(let step=0;step<Math.abs(limit-start);step++){
  const next=x+dir;
  if(next<=1||next>=width-2)break;
  const c=colProfile(data,width,height,next,y0,y1);
  const gap=c.edge>Math.max(18,interior.edge*1.5)&&c.variance<Math.max(30,interior.variance*.55);
  const empty=!sameTone(c,interior)&&c.variance<24&&c.edge<10;
  if(gap||empty)break;
  last=next;x=next;
 }
 return last;
}

function expandY(data,width,height,left,right,start,limit,dir,label){
 if(label.variance<16&&label.sat<12&&label.mean<22)return start;
 let y=start,last=start;
 for(let step=0;step<Math.abs(limit-start);step++){
  const next=y+dir;
  if(next<=1||next>=height-2)break;
  const jump=vertJump(data,width,next,left,right);
  const row=rowProfile(data,width,next,left,right);
  const shelf=jump>Math.max(42,label.sat*1.4)&&Math.abs(next-start)>6;
  const empty=!sameTone(row,label)&&row.variance<22&&row.sat<14;
  if(shelf||empty)break;
  last=next;y=next;
 }
 return last;
}

export function refineBookEdges(books,image){
 if(!books.length)return books;
 const {data,width,height}=image;
 const seeds=books.map(seedBox);
 const bandTop=Math.max(0,Math.min(...seeds.map(s=>s[1]))-8);
 const bandBottom=Math.min(height,Math.max(...seeds.map(s=>s[3]))+24);
 const edges=verticalEdges(data,width,bandTop,bandBottom);
 const lefts=seeds.map(s=>s[0]);
 const rights=seeds.map(s=>s[2]);
 for(let i=1;i<books.length;i++){
  const split=peakEdge(edges,rights[i-1],lefts[i]);
  rights[i-1]=split;lefts[i]=split;
 }
 const labelY0=Math.min(...seeds.map(s=>s[1])),labelY1=Math.max(...seeds.map(s=>s[3]));
 const firstW=Math.max(18,(rights[0]-lefts[0])*2.2);
 const lastW=Math.max(18,(rights[rights.length-1]-lefts[lefts.length-1])*2.2);
 lefts[0]=expandX(data,width,height,lefts[0],Math.max(2,lefts[0]-firstW),labelY0,labelY1,-1);
 rights[rights.length-1]=expandX(data,width,height,rights[rights.length-1],Math.min(width-2,rights[rights.length-1]+lastW),labelY0,labelY1,1);
 return books.map((book,i)=>{
  const seed=seeds[i];
  const left=Math.max(0,Math.min(lefts[i],rights[i]-2));
  const right=Math.min(width,Math.max(left+2,rights[i]));
  const label=rowProfile(data,width,Math.max(0,Math.min(height-1,Math.round((seed[1]+seed[3])/2))),left,right);
  const maxH=Math.max(seed[3]-seed[1],right-left)*10;
  const top=expandY(data,width,height,left,right,seed[1],Math.max(1,seed[3]-maxH),-1,label);
  const bottom=expandY(data,width,height,left,right,seed[3],Math.min(height-1,seed[1]+maxH),1,label);
  return {...book,bbox:[Math.round(left),Math.round(Math.min(top,seed[1])),Math.round(right),Math.round(Math.max(bottom,seed[3]))]};
 });
}
