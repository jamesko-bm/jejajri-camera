import {cropPixels} from './paddle-ocr.mjs';
import {inkMask,glyphVector,classify,columnClusters} from './jamo-shape.mjs';
import {isAuthor,isFullClass,snapShelfClasses} from './labels.mjs';

// Every call-number label has exactly one classification line (598.1), so each
// detected classification line is one book. Lines stacked under it on the same
// label are the author mark, then volume / copy.
const JUNK=/[|丨.'"`:;,·\s]/;
const TAIL_GUESS={'-':'ㄴ','—':'ㄴ','_':'ㄴ','~':'ㄴ',X:'ㅈ',x:'ㅈ',c:'ㄷ',C:'ㄷ','=':'ㅋ','≡':'ㅋ','0':'ㅇ',o:'ㅇ',O:'ㅇ','°':'ㅇ','©':'ㅇ','7':'ㄱ','ㅠ':'ㄱ',E:'ㅌ',L:'ㄴ'};

export function readClass(text){
 const t=String(text||'').replace(/\s+/g,'').replace(/^[|丨!'"`:;.,]+|[|丨!'"`:;,]+$/g,'').replace(/\.$/,'').replace(/[,·]/g,'.');
 const m=t.match(/^(\d{3})(?:\.(\d{1,4}))?$/);
 if(!m)return '';
 return m[2]?`${m[1]}.${m[2]}`:m[1];
}

function fixDigit(s){return s.replace(/[zZ]/g,'2').replace(/[lIi|!]/g,'1').replace(/[oO]/g,'0').replace(/[sS]/g,'5');}
export function readExtra(text){
 const t=String(text||'').replace(/\s+/g,'');
 const v=t.match(/^[^a-zA-Z]*[vV][.,]?([0-9zZlIi|!sS]{1,2})/),c=t.match(/^[^a-zA-Z]*(?:[vV][.,]?[0-9zZlIi|!sS]{1,2}[^a-zA-Z]*)?(?:[cCeG]|[0oO](?=[.,]))[.,]?([0-9zZlIi|!sS]{1,2})/);
 return {volume:v?String(Number(fixDigit(v[1]))||''):'',copy:c?String(Number(fixDigit(c[1]))||''):''};
}

// Detection sometimes cuts one text line into pieces (시1 | 3ㅂ). Rejoin pieces on
// the same row with a gap narrower than a character; neighbouring labels are far wider apart.
export function mergeLineBoxes(boxes){
 const list=boxes.map(b=>({...b})).sort((p,q)=>p.x0-q.x0);
 let changed=true;
 while(changed){
  changed=false;
  for(let i=0;i<list.length&&!changed;i++)for(let j=i+1;j<list.length&&!changed;j++){
   const a=list[i],b=list[j],ha=a.y1-a.y0,hb=b.y1-b.y0,h=Math.min(ha,hb);
   const vy=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0),gap=Math.max(a.x0,b.x0)-Math.min(a.x1,b.x1);
   const short=Math.min(a.x1-a.x0,b.x1-b.x0)<=h*1.6;
   if(short&&vy>=h*.6&&gap<=h*.35&&Math.max(ha,hb)<=h*1.5){
    list[i]={x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1),score:Math.max(a.score,b.score)};
    list.splice(j,1);changed=true;
   }
  }
 }
 return list;
}

// Pieces of one label row that both sit under the same classification line.
function joinRows(lines){
 const rows=[];
 for(const l of lines.slice().sort((p,q)=>p.x0-q.x0)){
  const row=rows.find(r=>Math.min(r.y1,l.y1)-Math.max(r.y0,l.y0)>=Math.min(r.y1-r.y0,l.y1-l.y0)*.5);
  if(!row){rows.push({...l,parts:[l]});continue;}
  row.parts.push(l);
  row.x0=Math.min(row.x0,l.x0);row.y0=Math.min(row.y0,l.y0);row.x1=Math.max(row.x1,l.x1);row.y1=Math.max(row.y1,l.y1);
 }
 return rows.map(r=>r.parts.length===1?r.parts[0]:{...r,h:r.y1-r.y0,text:r.parts.map(p=>p.text).join(''),joined:true});
}

const overlapX=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))/Math.max(1,Math.min(a.x1-a.x0,b.x1-b.x0));
const median=v=>{const s=v.slice().sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};

const JAMO_SHAPES='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

// The glyph cluster after the cutter digits is the jamo. When the recognizer
// reads it as part of the number (0 for ㅇ, 7 for ㄱ, 8 for ㅂ), check the last digit's shape.
function glyphClusters(pixels){
 const mask=inkMask(pixels),minInk=Math.max(2,mask.height*.08);
 // Book edges and sticker borders run the full height of the line; letters do not.
 for(let x=0;x<mask.width;x++){
  let n=0;for(let y=0;y<mask.height;y++)n+=mask.ink[y*mask.width+x];
  if(n>mask.height*.8)for(let y=0;y<mask.height;y++)mask.ink[y*mask.width+x]=0;
 }
 const clusters=columnClusters(mask).filter(([a,b])=>{
  let n=0;for(let x=a;x<b;x++)for(let y=0;y<mask.height;y++)n+=mask.ink[y*mask.width+x];
  return n>=minInk*2&&b-a>=2;
 });
 return {mask,clusters};
}

// 이 prints as ㅇ followed by ㅣ, which reads as "01", "0" or "이1". Find where the
// syllable ends (a round part, then a thin bar) so the number can be read alone.
function afterI(pixels){
 const {mask,clusters}=glyphClusters(pixels);
 if(clusters.length<2)return [];
 const g0=glyphVector(mask,clusters[0][0],clusters[0][1]);
 if(!g0)return [];
 const w1=clusters[1][1]-clusters[1][0];
 // When ㅇ and ㅣ touch they form one cluster, so the cut after it is the fallback.
 if(g0.aspect>=.4&&g0.aspect<=1.5&&w1<=g0.height*.45&&clusters.length>=3)return [clusters[1][1],clusters[0][1]];
 if(g0.aspect>1.5&&g0.aspect<=2.6)return [clusters[0][1]];
 return [];
}

function parseAuthorFrames(frames){
 let i=0;
 while(i<frames.length&&!/[가-힣0-9]/.test(frames[i].ch))i++;
 let surname='';
 while(i<frames.length&&/[가-힣]/.test(frames[i].ch)&&surname.length<3){surname+=frames[i].ch;i++;}
 while(i<frames.length&&JUNK.test(frames[i].ch))i++;
 let digits='',lastDigit=null;const digitFrames=[];
 while(i<frames.length&&/\d/.test(frames[i].ch)){digits+=frames[i].ch;lastDigit=frames[i];digitFrames.push(frames[i]);i++;}
 const tail=frames.slice(i).filter(c=>!JUNK.test(c.ch));
 // An ㅇ followed by the next book's edge reads as a trailing "01".
 let ringBar=false;
 if(!tail.length&&digits.length>=3&&digits.endsWith('01')){digits=digits.slice(0,-1);digitFrames.pop();lastDigit=digitFrames[digitFrames.length-1];ringBar=true;}
 return {surname,digits,lastDigit,tail,ringBar,lead:frames.find(f=>!JUNK.test(f.ch))?.ch||''};
}

function shapeTail(pixels,res,lastDigit,digits,templates){
 if(!templates||!lastDigit)return null;
 const {mask,clusters}=glyphClusters(pixels);
 if(!clusters.length)return null;
 const cx=(lastDigit.t+.5)*pixels.width/res.steps;
 let k=0;
 clusters.forEach(([a,b],i)=>{const [p,q]=clusters[k];if(Math.abs((a+b)/2-cx)<Math.abs((p+q)/2-cx))k=i;});
 const heightOf=i=>i>=0&&clusters[i]?glyphVector(mask,clusters[i][0],clusters[i][1])?.height||0:0;
 const digitBox=glyphVector(mask,clusters[k][0],clusters[k][1])?.box;
 const band=digitBox?[digitBox[1]-(digitBox[3]-digitBox[1])*.25,digitBox[3]+(digitBox[3]-digitBox[1])*.25]:null;
 const rest=clusters.slice(k+1);
 if(rest.length){
  // The jamo is the first cluster; a second one belongs to it only when it is a
  // close twin (ㄲ, ㄸ), not a thin bar from the next label.
  let end=rest[0][1];
  const w0=rest[0][1]-rest[0][0],lineH=digitBox?digitBox[3]-digitBox[1]:mask.height;
  if(rest[1]&&rest[1][0]-rest[0][1]<=lineH*.2&&rest[1][1]-rest[1][0]>=w0*.5)end=rest[1][1];
  const g=glyphVector(mask,rest[0][0],end,band);
  const pick=classify(g,templates,JAMO_SHAPES,heightOf(k));
  if(pick.distance<=.6){
   // The first stroke of ㄲ can also come out as a trailing 7 that lands on the
   // previous digit's cluster; then that cluster still looks like the previous digit.
   const seen=digits.length>=2&&pick.ch==='ㄲ'&&digits.endsWith('7')?classify(glyphVector(mask,clusters[k][0],clusters[k][1],band),templates,'0123456789').ch:'';
   return {...pick,swallowed:false,ghost:!!seen&&seen!==digits.slice(-1)&&seen===digits.slice(-2,-1)};
  }
 }
 const last=digits.slice(-1);
 if(digits.length<2)return null;
 const ref=heightOf(k-1),glyph=glyphVector(mask,clusters[k][0],clusters[k][1],band);
 // A printed digit 0 is taller than wide; the ㅇ after a cutter number is wider than tall.
 if(last==='0'){
  if(!glyph||glyph.aspect<1)return null;
  const jamo=classify(glyph,templates,JAMO_SHAPES,ref);
  return {...(jamo.ch&&jamo.distance<=.45?jamo:{ch:'ㅇ',distance:0}),swallowed:true};
 }
 let pick=classify(glyph,templates,JAMO_SHAPES+last,ref);
 if(k>=3){
  const pair=classify(glyphVector(mask,clusters[k-1][0],clusters[k][1]),templates,'ㄲㄸㅃㅆㅉ',heightOf(k-2));
  if(pair.distance<pick.distance)pick={...pair,pair:digits.length>=3&&digits.at(-1)===digits.at(-2)};
 }
 return pick.ch&&pick.ch!==last&&pick.distance<=.5?{...pick,swallowed:true}:null;
}

async function readAuthor(reader,pixels,templates){
 let res=await reader.recognize(pixels);
 let {surname,digits,lastDigit,tail,ringBar}=parseAuthorFrames(res.frames);
 let note='';
 if((!surname&&/^0/.test(digits))||surname==='이'){
  // The whole-line read keeps every digit after the 이 ("0164", "이64"); a cut
  // that loses some of them went one glyph too far.
  const expect=surname==='이'?digits:digits.replace(/^0[1lI]?/,'');
  const cuts=afterI(pixels);
  for(const cut of cuts){
   const rest=cropPixels(pixels,Math.max(0,cut-1),0,pixels.width,pixels.height);
   const again=await reader.recognize(rest);
   const parsed=parseAuthorFrames(again.frames);
   if(!parsed.digits||parsed.surname)continue;
   if([expect,expect.slice(0,-1)].some(e=>e.length>=2&&e.length>parsed.digits.length&&e.endsWith(parsed.digits)))continue;
   note=`(이|${again.text})`;
   pixels=rest;res=again;surname='이';
   ({digits,lastDigit,tail,ringBar}=parsed);
   if(cut!==cuts[0]&&/^1./.test(digits)&&!expect.startsWith('1')&&expect.startsWith(digits.slice(1)))digits=digits.slice(1);
   break;
  }
 }
 // A half-hidden 이 at the left edge reads as D1 / O1 / J1.
 if(!surname&&/^[CDGJOQUo]$/.test(parseAuthorFrames(res.frames).lead)&&/^1\d/.test(digits)){surname='이';digits=digits.slice(1);}
 if(!surname){
  // A surname such as 시 next to a 1 can vanish from the whole-line read; the left half alone keeps it.
  const leftWidth=pixels.width*.5;
  const left=await reader.recognize(cropPixels(pixels,0,0,leftWidth,pixels.height));
  const m=left.text.replace(/[|丨.'"`:;,·\s]/g,'').match(/^([가-힣]{1,3})(\d*)/);
  const lf=left.frames,si=lf.findIndex(f=>/[가-힣]/.test(f.ch));
  let reread=null;
  if(m&&si>=0&&lf[si+1]){
   const cut=Math.round((lf[si].t+lf[si+1].t+1)/2*leftWidth/left.steps);
   const rest=cropPixels(pixels,cut,0,pixels.width,pixels.height);
   const again=await reader.recognize(rest);
   const parsed=parseAuthorFrames(again.frames);
   if(parsed.digits&&!parsed.surname&&!/^0/.test(parsed.digits))reread={rest,again,parsed};
  }
  if(reread){
   surname=m[1];note=`(L:${left.text}|${reread.again.text})`;
   pixels=reread.rest;res=reread.again;
   ({digits,lastDigit,tail,ringBar}=reread.parsed);
  }else if(m){
   surname=m[1];note=`(L:${left.text})`;
   if(surname==='이'&&/^0/.test(digits)){
    const options=[digits.replace(/^01/,''),digits.slice(1)].filter(Boolean);
    digits=options.find(d=>!m[2]||d.startsWith(m[2]))||options[0]||'';
   }else if(m[2]&&!digits.startsWith(m[2]))digits=m[2]+digits;
  }else if(/^0[1lI]?\d/.test(digits)){
   surname='이';digits=digits.replace(/^0[1lI]?/,'');
  }
 }
 if(!digits)return {author:'',raw:res.text};
 let jamo='',after='';
 const first=tail[0];
 const shape=shapeTail(pixels,res,lastDigit,digits,templates);
 if(shape?.ch){
  jamo=shape.ch;
  if(shape.swallowed||shape.ghost)digits=digits.slice(0,shape.pair?-2:-1);
  else if(first&&/[ㄱ-ㅎ]/.test(first.ch))after=tail.slice(1).map(c=>c.ch).join('').match(/^\d{0,3}/)[0];
 }else if(first&&/[ㄱ-ㅎ]/.test(first.ch)){
  jamo=first.ch;
  after=tail.slice(1).map(c=>c.ch).join('').match(/^\d{0,3}/)[0];
 }else if(first){
  jamo=TAIL_GUESS[first.ch]||'';
 }else if(ringBar&&digits.length>=2&&digits.endsWith('0')){
  jamo='ㅇ';digits=digits.slice(0,-1);
 }
 return {author:`${surname}${digits}${jamo}${after}`,surname,raw:res.text+note+(shape?.ch?`[${shape.ch}${shape.swallowed?'*':''} ${shape.distance.toFixed(3)}]`:'')};
}

// Fill a surname the recognizer dropped only when both shelf neighbours agree,
// or when one neighbour carries the very same number (a second copy).
function fillSurnames(books){
 const sur=books.map(b=>(b.author.match(/^[가-힣]{1,3}/)||[''])[0]);
 return books.map((b,i)=>{
  if(!b.author||sur[i])return b;
  let l='',r='',li=-1,ri=-1;
  for(let k=i-1;k>=0&&!l;k--){l=sur[k];li=k;}
  for(let k=i+1;k<books.length&&!r;k++){r=sur[k];ri=k;}
  const same=k=>k>=0&&books[k].author.slice(sur[k].length)===b.author;
  const pick=l&&l===r?l:(!l&&r)||(!r&&l)||(same(li)?l:same(ri)?r:'');
  return pick&&isAuthor(pick+b.author)?{...b,author:pick+b.author}:b;
 });
}

export async function readShelfLabels(reader,photo,{band=null,templates=null,isCurrent=()=>true}={}){
 let region={x0:0,y0:0,x1:photo.width,y1:photo.height};
 if(band){
  const h=band[1]-band[0];
  region={x0:0,y0:Math.max(0,band[0]-h*3),x1:photo.width,y1:Math.min(photo.height,band[1]+h*1.5)};
 }
 const attempt=async r=>{
  const pixels=cropPixels(photo,r.x0,r.y0,r.x1,r.y1);
  const boxes=await reader.detect(pixels,Math.min(4096,Math.max(pixels.width,pixels.height)));
  for(const b of boxes){b.x0+=r.x0;b.x1+=r.x0;b.y0+=r.y0;b.y1+=r.y0;}
  return mergeLineBoxes(boxes);
 };
 let boxes=await attempt(region);
 const lines=[];
 const readAll=async list=>{
  lines.length=0;
  for(const b of list){
   if(!isCurrent())return;
   const h=b.y1-b.y0,w=b.x1-b.x0;
   if(h<6||w<6||w>h*14)continue;
   const res=await reader.recognize(cropPixels(photo,b.x0,b.y0,b.x1,b.y1));
   lines.push({...b,h,text:res.text,cls:readClass(res.text)});
  }
 };
 await readAll(boxes);
 const anchorsOf=()=>{
  let a=lines.filter(l=>l.cls&&!/^(500|000|50|00)$/.test(l.cls));
  const mh=median(a.filter(l=>isFullClass(l.cls)).map(l=>l.h))||median(a.map(l=>l.h));
  a=a.filter(l=>l.h>=mh*.55&&l.h<=mh*1.35&&!/^(500|000)\./.test(l.cls)&&(isFullClass(l.cls)||l.h<=mh*1.25));
  a.sort((p,q)=>p.x0-q.x0);
  const merged=[];
  for(const l of a){
   const prev=merged[merged.length-1];
   if(prev&&overlapX(prev,l)>.5&&Math.abs(prev.y0-l.y0)<mh)continue;
   merged.push(l);
  }
  // A bare number (053) a line below the neighbouring classes, or starting
  // with the 0 of 이 on a shelf of non-0xx classes, is an author line whose
  // class line was cut off.
  const full=merged.filter(l=>isFullClass(l.cls));
  const zeroShelf=full.filter(l=>l.cls.startsWith('0')).length*2>full.length;
  const kept=merged.filter(l=>{
   if(isFullClass(l.cls)||!/^\d{3}$/.test(l.cls)||!full.length)return true;
   if(l.cls.startsWith('0')&&!zeroShelf)return false;
   const near=full.reduce((p,q)=>Math.abs(q.x0-l.x0)<Math.abs(p.x0-l.x0)?q:p);
   return l.y0-near.y0<mh*.7;
  });
  return {anchors:kept,mh};
 };
 let {anchors,mh}=anchorsOf();
 if(anchors.length<2&&band){
  boxes=await attempt({x0:0,y0:0,x1:photo.width,y1:photo.height});
  await readAll(boxes);
  ({anchors,mh}=anchorsOf());
 }
 if(!isCurrent()||!anchors.length)return [];
 const books=anchors.map(a=>({anchor:a,below:[]}));
 for(const l of lines){
  if(anchors.includes(l)||/^(500|000|50)$/.test(l.cls)||/^[5O0]{2,}$/.test(l.text.replace(/\s+/g,''))||l.h>mh*1.7)continue;
  let best=null,score=0;
  for(const book of books){
   const a=book.anchor;
   if(!a)continue;
   const dy=l.y0-a.y0;
   if(dy<a.h*.5||dy>a.h*4.5)continue;
   const o=overlapX(a,l);
   if(o>score){score=o;best=book;}
  }
  if(best&&score>=.35)best.below.push(l);
  else if((/[가-힣]\d/.test(l.text)||/^[0OP]?[1lI]?[1-9]\d{1,2}[^\d.]?$/.test(l.text.replace(/\s+/g,'')))&&l.h<=mh*1.4&&l.h>=mh*.6){
   const top=Math.min(...anchors.map(a=>a.y0)),bottom=Math.max(...anchors.map(a=>a.y1));
   if(l.y0>=top&&l.y0<=bottom+mh*3)books.push({anchor:null,below:[l]});
  }
 }
 const out=[];
 for(const book of books){
  if(!isCurrent())return [];
  book.below=joinRows(book.below);
  book.below.sort((p,q)=>p.y0-q.y0);
  let author='',volume='',copy='',raw=[];
  for(const l of book.below){
   const extra=readExtra(l.text);
   if(!author&&!extra.volume&&!extra.copy&&/[가-힣0-9]/.test(l.text)){
    const read=await readAuthor(reader,cropPixels(photo,l.x0,l.y0,l.x1,l.y1),templates);
    author=read.author;raw.push(read.raw);
    continue;
   }
   volume=volume||extra.volume;copy=copy||extra.copy;raw.push(l.text);
  }
  const parts=[book.anchor,...book.below].filter(Boolean);
  const box=[Math.min(...parts.map(p=>p.x0)),Math.min(...parts.map(p=>p.y0)),Math.max(...parts.map(p=>p.x1)),Math.max(...parts.map(p=>p.y1))];
  out.push({classification:book.anchor?book.anchor.cls:'',author,volume,copy,box,raw:[book.anchor?.text||'',...raw]});
 }
 out.sort((p,q)=>(p.box[0]+p.box[2])-(q.box[0]+q.box[2]));
 // A fully read class such as 598.4 among 598.1 books is real (and likely
 // misplaced); only partial reads (598, 598.) borrow the shelf's class.
 const snapped=snapShelfClasses(out);
 const neighbourClass=i=>{
  let l='',r='';
  for(let k=i-1;k>=0&&!l;k--)if(isFullClass(out[k].classification))l=out[k].classification;
  for(let k=i+1;k<out.length&&!r;k++)if(isFullClass(out[k].classification))r=out[k].classification;
  return l&&l===r?l:(!l&&r)||(!r&&l)||'';
 };
 return fillSurnames(out.map((b,i)=>{
  if(isFullClass(b.classification))return b;
  const c=snapped[i].classification||(!b.classification?neighbourClass(i):'');
  return {...b,classification:c&&(!b.classification||c.startsWith(b.classification))?c:b.classification,guessed:true};
 })).map(b=>({...b,uncertain:!!b.guessed||!isFullClass(b.classification)||!isAuthor(b.author)}));
}
