import {isAuthor} from './labels.mjs';
const natural = s => s.match(/\d+|\D+/g) || [];
const cutter = (x,y)=>{const n=Math.max(x.length,y.length);return x.padEnd(n,'0').localeCompare(y.padEnd(n,'0'));};
export function compare(a,b){
 const decimal=(x,y)=>{const [xi,xf='']=String(x).split('.'),[yi,yf='']=String(y).split('.');if(Number(xi)!==Number(yi))return Number(xi)-Number(yi);return cutter(xf,yf);};
 let d=decimal(a.classification,b.classification);if(d)return d;
 const aa=natural(a.author),bb=natural(b.author);
 let firstDigits=true;
 for(let i=0;i<Math.min(aa.length,bb.length);i++){
  const x=aa[i],y=bb[i];
  if(x===y){if(/^\d+$/.test(x))firstDigits=false;continue;}
  const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
  if(nx&&ny){d=firstDigits?cutter(x,y):Number(x)-Number(y);firstDigits=false;}
  else if(nx!==ny)d=nx?1:-1;
  else d=x<y?-1:1;
  if(d)return d;
 }
 if(aa.length!==bb.length)return aa.length-bb.length;
 return Number(a.volume||0)-Number(b.volume||0);
}
export function misplaced(books){
 if(!books.length)return [];
 const length=books.map(()=>1),prev=books.map(()=>-1);
 for(let i=0;i<books.length;i++)for(let j=0;j<i;j++)if(compare(books[j],books[i])<=0&&length[j]+1>length[i]){length[i]=length[j]+1;prev[i]=j;}
 let cursor=length.indexOf(Math.max(...length));const keep=new Set();while(cursor>=0){keep.add(cursor);cursor=prev[cursor];}return books.filter((_,i)=>!keep.has(i));
}
export function moves(books,errors){const ids=new Set(errors.map(b=>b.id));const remaining=books.filter(b=>!ids.has(b.id));return [...errors].sort(compare).map(book=>{let index=remaining.findIndex(b=>compare(b,book)>0);if(index<0)index=remaining.length;const step={book,position:index+1,left:remaining[index-1],right:remaining[index]};remaining.splice(index,0,book);return step;});}
export function validate(books,width,height){const errors=[];for(const b of books){if(!b.confirmed)errors.push(`${b.id}: 확인이 필요합니다.`);if(!/^\d{3}(?:\.\d+)?$/.test(b.classification)||!isAuthor(b.author)||! /^[1-9]\d*$/.test(b.volume)||!Number.isSafeInteger(Number(b.volume)))errors.push(`${b.id}: 분류번호·저자기호·권차를 확인하세요.`);const [x,y,r,d]=b.bbox;if(!b.bbox.every(Number.isFinite)||!(0<=x&&x<r&&r<=width&&0<=y&&y<d&&d<=height))errors.push(`${b.id}: 책 영역을 확인하세요.`);}const ordered=[...books].sort((a,b)=>a.bbox[0]-b.bbox[0]);for(let i=1;i<ordered.length;i++)if(ordered[i-1].bbox[2]>ordered[i].bbox[0])errors.push(`${ordered[i-1].id}와 ${ordered[i].id} 영역이 겹칩니다.`);return errors;}
export function candidates(words,shelf){
 const anchors=words.filter(w=>/^\d{3}(?:\.\d+)?$/.test(w.text.trim())).sort((a,b)=>a.bbox.y0-b.bbox.y0), chosen=[];
 const center=w=>(w.bbox.x0+w.bbox.x1)/2;
 for(const w of anchors)if(!chosen.some(a=>Math.abs(center(a)-center(w))<Math.max(16,(a.bbox.x1-a.bbox.x0)*(w.bbox.y0>=a.bbox.y1?1.6:.65))))chosen.push(w);
 chosen.sort((a,b)=>center(a)-center(b));
 return chosen.map((a,i)=>{const left=i?Math.round((center(chosen[i-1])+center(a))/2):shelf[0],right=i===chosen.length-1?shelf[2]:Math.round((center(a)+center(chosen[i+1]))/2);const nearby=words.filter(w=>center(w)>=left&&center(w)<right&&w.bbox.y0>=a.bbox.y0-3).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);const lines=[];for(const w of nearby){let line=lines.find(l=>Math.abs(l.y-w.bbox.y0)<Math.max(8,(w.bbox.y1-w.bbox.y0)*.6));if(!line){line={y:w.bbox.y0,words:[]};lines.push(line);}line.words.push(w);}const texts=lines.map(l=>l.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text).join(''));return {id:`V${String(i+1).padStart(2,'0')}`,classification:a.text.trim(),author:/[가-힣A-Za-z]/.test(texts[1]||'')?texts[1]:'',volume:(texts[2]||'').match(/^(?:v\.?|권)?([1-9]\d*)$/i)?.[1]||'',bbox:[left,shelf[1],right,shelf[3]],confirmed:false};});
}
