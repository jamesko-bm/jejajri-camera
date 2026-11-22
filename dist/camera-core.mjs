import {compare,candidates} from './ordering.mjs';

// A decrease flags the preceding (left) book, as requested by the user.
export function decreasingBooks(books){
 const flagged=[],uncertain=[];
 for(let i=1;i<books.length;i++){
  const a=books[i-1],b=books[i];
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
 reset(){this.revision=(this.revision||0)+1;this.reference=null;this.previous=null;this.lastMotion=0;this.nextTry=0;this.done=false;this.busy=this.busy||false;}
 tick(signature,now){
  const moved=!this.reference||frameDifference(signature,this.previous)>this.threshold||frameDifference(signature,this.reference)>this.threshold;
  if(moved){this.revision++;this.reference=signature.slice();this.lastMotion=now;this.done=false;this.nextTry=0;}
  this.previous=signature.slice();return {moved,ready:!this.busy&&!this.done&&now-this.lastMotion>=this.settleMs&&now>=this.nextTry};
 }
 begin(){this.busy=true;this.activeToken=this.revision;return this.revision;}
 finish(token,complete,now){if(token!==this.activeToken)return false;this.busy=false;this.activeToken=null;if(token!==this.revision)return false;this.done=complete;this.nextTry=now+this.retryMs;return true;}
}

export function cameraCandidates(words,width,height){
 const valid=words.filter(w=>Number(w.confidence??100)>=45);
 const anchors=valid.filter(w=>/^\d{3}(?:\.\d+)?$/.test(w.text.trim()));
 // A single shelf at a time: choose the most populated classification row.
 let row=[];
 for(const anchor of anchors){const tolerance=Math.max(16,(anchor.bbox.y1-anchor.bbox.y0)*1.7);const group=anchors.filter(w=>Math.abs(w.bbox.y0-anchor.bbox.y0)<tolerance);if(group.length>row.length)row=group;}
 if(row.length<2)return [];
 const y0=Math.min(...row.map(w=>w.bbox.y0)),labelHeight=Math.max(...row.map(w=>w.bbox.y1-w.bbox.y0));
 const wordStrip=valid.filter(w=>w.bbox.y0>=y0-labelHeight*.35&&w.bbox.y0<=y0+labelHeight*5.5);
 const bottom=Math.min(height,Math.round(y0+labelHeight*5.8));
 const rows=candidates(wordStrip,[0,0,width,bottom]);
 // Requiring nearby author text suppresses isolated title-page numbers.
 return rows.map(b=>({...b,author:/^[가-힣A-Za-z][가-힣A-Za-z0-9.-]*$/.test(b.author)?b.author:'',volume:/^[1-9]\d*$/.test(b.volume)?b.volume:''}));
}

export function refineBookEdges(books,image){
 if(books.length<2)return books;
 const {data,width,height}=image;
 const edges=new Float64Array(width);
 const start=Math.round(height*.15),end=Math.min(height-1,Math.round(books[0].bbox[3]*.85));
 for(let x=2;x<width-2;x++)for(let y=start;y<end;y+=3){const a=(y*width+x-2)*4,b=(y*width+x+2)*4;edges[x]+=Math.abs(data[a]-data[b])+Math.abs(data[a+1]-data[b+1])+Math.abs(data[a+2]-data[b+2]);}
 const boundaries=[0];
 for(let i=1;i<books.length;i++){
  const guess=books[i].bbox[0],span=Math.max(4,Math.round(Math.min(books[i].bbox[2]-guess,guess-books[i-1].bbox[0])*.22));
  let best=Math.round(guess),score=-1;
  for(let x=Math.max(2,Math.round(guess-span));x<Math.min(width-2,guess+span);x++){const s=edges[x]+edges[x-1]+edges[x+1];if(s>score){score=s;best=x;}}
  boundaries.push(best);
 }
 boundaries.push(width);
 return books.map((b,i)=>({...b,bbox:[boundaries[i],b.bbox[1],boundaries[i+1],b.bbox[3]]}));
}
