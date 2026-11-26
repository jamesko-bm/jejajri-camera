// Keep compatibility jamo (ㄱ, ㅋ, …); NFKC would change their ordering.
export const cleanLabel = text => String(text).normalize('NFC').replace(/\s+/g,'').replace(/[．。]/g,'.');
// 저자기호는 한글, 숫자, 그리고 끝의 자모·숫자다. 예: 이211ㅋ, 진91ㅋ, 김94ㄱ2, 슈38ㅋ.
export const isAuthor = text => /^[가-힣]{1,3}\d{1,4}(?:[ㄱ-ㅎㅏ-ㅣ]\d{0,3})?$/.test(text);
export const isCollectionBadge = text => /^(000|500)$/.test(text);
export const isFullClass = text => /^\d{3}\.\d{1,4}$/.test(text);
export const isAnyClass = text => /^\d{3}(?:\.\d{1,4})?$/.test(text);
// Yellow 500 / blue 000 stickers are location badges, not the call number.
export function preferClass(current,next){
 if(!next||!isAnyClass(next))return current;
 if(!current)return next;
 if(isCollectionBadge(current)&&!isCollectionBadge(next))return next;
 if(!isCollectionBadge(current)&&isCollectionBadge(next))return current;
 if(isFullClass(next)&&!isFullClass(current))return next;
 return current;
}
export function takeVolume(text){
 const flat=String(text||'').replace(/[|丨]/g,' ').replace(/\s+/g,' ').trim();
 const found=flat.match(/(?:^|\s)(?:c|v|권)\s*[.\s]?\s*([1-9]\d?)(?:\s|$)/i);
 return found?found[1]:'';
}
// A leading 0 on an author line is the usual misread of 이, as in 0164ㄷ.
function finishAuthor(compact){
 let body=compact.replace(/^1(?=[가-힣])/,'').replace(/([ㄱ-ㅎ])\1+$/,'$1').replace(/^[oO][lI]/,'01').replace(/^[oO](?=\d)/,'0');
 if(/^[0Oo]\d+[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(body)&&!body.includes('.')){
  body=body.slice(1);
  // 이 is often split into a 0 and a stray 1.
  if(/^1\d{2,}[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(body))body=body.slice(1);
  body='이'+body;
 }
 return isAuthor(body)?body:'';
}
export function normalizeAuthor(text){
 const compact=cleanLabel(text).replace(/[|丨\-‐‑–—/]/g,'');
 const closed=/^[0Oo]\d{3,}3$/.test(compact)?`${compact.slice(0,-1)}ㅋ`:compact;
 return finishAuthor(compact)||finishAuthor(compact.replace(/=+$/,'ㅋ'))||finishAuthor(closed);
}
// A round cutter mark is often read as © or a trailing 6. Keep it as ㅇ when the glyph is a circle.
export function circleAuthor(text){
 const found=String(text).replace(/[©○●∘◦®]/g,'ㅇ').replace(/\s+/g,'').match(/[가-힣]{1,3}\d{1,4}ㅇ/);
 return found&&isAuthor(found[0])?found[0]:'';
}
// Classification is NNN or NNN.N–NNNN. A leading 1 is a spine edge; 05.13 is a dropped 0.
function takeClass(token){
 const original=cleanLabel(token).replace(/[|丨]/g,'').replace(/,/g,'.').replace(/\.+$/,'');
 if(!original)return {classification:'',rest:''};
 if(/^[가-힣]/.test(original))return {classification:'',rest:original};
 const compact=original.replace(/^[^0-9]+/,'');
 if(!compact)return {classification:'',rest:original};
 const lead=compact.match(/^1(0\d{2}\.\d{1,4})(?!\d)(.*)$/);
 if(lead)return {classification:lead[1],rest:lead[2]};
 const exact=compact.match(/^(\d{3}\.\d{1,4})(?!\d)(.*)$/);
 if(exact)return {classification:exact[1],rest:exact[2]};
 const dropped=compact.match(/^(0[1-9]\.\d{1,4})(?!\d)(.*)$/);
 if(dropped)return {classification:`0${dropped[1]}`,rest:dropped[2]};
 if(!compact.includes('.')){
  const hangul=/[가-힣ㄱ-ㅎㅏ-ㅣ]/;
  const five=compact.match(/^(\d{3})(\d{2})(?!\d)(.*)$/);
  if(five&&!hangul.test(five[3]))return {classification:`${five[1]}.${five[2]}`,rest:five[3]};
  const four=compact.match(/^(\d{3})(\d)(?!\d)(.*)$/);
  if(four&&!hangul.test(four[3]))return {classification:`${four[1]}.${four[2]}`,rest:four[3]};
 }
 const bare=compact.match(/^(\d{3})(?!\d)(.*)$/);
 if(bare)return {classification:bare[1],rest:bare[2]};
 return {classification:'',rest:compact};
}
export function repairClass(text){
 const taken=takeClass(text);
 if(taken.rest||isCollectionBadge(taken.classification))return '';
 return taken.classification;
}
function readLineFields(line){
 const flat=String(line).replace(/[|丨]/g,'').replace(/[．。]/g,'.').replace(/(\d)\s+\./g,'$1.').replace(/\.\s+(\d)/g,'.$1').replace(/[ \t]+/g,' ').trim();
 let classification='',pending='';
 for(const token of flat.split(' ').filter(Boolean)){
  const taken=takeClass(token);
  if(taken.classification){
   classification=preferClass(classification,taken.classification);
   pending+=taken.rest;
  }
  else pending+=token;
 }
 return {classification,author:normalizeAuthor(pending)};
}
// A spine label is two lines: 005.13 / 이211ㅋ or 598.1 / 슈38ㅋ. Either line may arrive first.
export function interpretCallNumber(...parts){
 let classification='',author='',volume='';
 for(const part of parts){
  for(const line of String(part??'').split(/\r?\n/)){
   const vol=takeVolume(line);
   if(vol&&!volume)volume=vol;
   const fields=readLineFields(line);
   classification=preferClass(classification,fields.classification);
   if(fields.author)author=fields.author;
  }
 }
 return {classification,author,volume};
}
export function parseShelfText(raw){
 const flat=String(raw).replace(/[|丨]/g,'').replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ.=\s]/g,'').replace(/(\d)\s+\./g,'$1.').replace(/\.\s+(\d)/g,'.$1').replace(/\s+/g,' ').trim();
 const decimal=flat.match(/(?:^|\D)(\d{3}\.\d{1,4})(?!\d)/);
 const dropped=flat.match(/(?:^|\D)(0[1-9]\.\d{1,4})(?!\d)/);
 const integer=flat.match(/(?:^|\s)(\d{3})(?=\s|$)/);
 const classification=decimal?.[1]||(dropped?`0${dropped[1]}`:'')||integer?.[1]||'';
 const rest=classification?flat.replace(classification.startsWith('0')&&dropped&&!decimal?dropped[1]:classification,''):flat;
 return {classification,author:normalizeAuthor(rest),volume:takeVolume(raw)};
}
const center = w => (w.bbox.x0+w.bbox.x1)/2;
const lineHeight = w => w.bbox.y1-w.bbox.y0;

export function readLabels(words,width,height,minLabels=2){
 const valid=words.filter(w=>w.bbox&&Number(w.confidence??100)>=45).map(w=>({...w,text:cleanLabel(w.text)}));
 // Join OCR fragments only on the same baseline with a small horizontal gap.
 const spans=[];
 for(const start of valid){
  let chain=[start],last=start;
  for(let step=0;step<5;step++){
   const box={x0:Math.min(...chain.map(w=>w.bbox.x0)),y0:Math.min(...chain.map(w=>w.bbox.y0)),x1:Math.max(...chain.map(w=>w.bbox.x1)),y1:Math.max(...chain.map(w=>w.bbox.y1))};
   spans.push({text:chain.map(w=>w.text).join(''),bbox:box,confidence:Math.min(...chain.map(w=>Number(w.confidence??100)))});
   const next=valid.filter(w=>w.bbox.x0>last.bbox.x0&&!chain.includes(w)&&w.bbox.x0-last.bbox.x1<=Math.max(lineHeight(w),lineHeight(last))*.8&&Math.min(w.bbox.y1,last.bbox.y1)-Math.max(w.bbox.y0,last.bbox.y0)>=Math.min(lineHeight(w),lineHeight(last))*.5).sort((a,b)=>a.bbox.x0-b.bbox.x0)[0];
   if(!next)break;chain.push(next);last=next;
  }
 }
 const authors=spans.map(w=>({...w,text:normalizeAuthor(w.text)})).filter(w=>w.text);
 let anchors=spans.filter(w=>/^\d{3}(?:\.\d+)?$/.test(w.text));
 // Prefer a full decimal to an overlapping integer fragment.
 anchors=anchors.filter(a=>!anchors.some(b=>b!==a&&b.text.length>a.text.length&&b.bbox.x0<=a.bbox.x0&&b.bbox.x1>=a.bbox.x1&&Math.abs(b.bbox.y0-a.bbox.y0)<3));
 // A 500/000 badge on the same spine as 598.1 is the location sticker, not the class.
 anchors=anchors.filter(a=>!(isCollectionBadge(a.text)&&anchors.some(b=>b!==a&&isFullClass(b.text)&&Math.abs(center(b)-center(a))<=Math.max(lineHeight(a),lineHeight(b))*1.6)));
 const labels=anchors.map(a=>{
  const h=lineHeight(a),cx=center(a);
  const nearby=authors.filter(b=>b.bbox.x0>=a.bbox.x0-h*.8&&b.bbox.x0<=a.bbox.x1&&b.bbox.y0>=a.bbox.y1-h*.25&&b.bbox.y0<=a.bbox.y1+h*2.2&&Math.abs(center(b)-cx)<=Math.max(a.bbox.x1-a.bbox.x0,b.bbox.x1-b.bbox.x0)*.65);
  nearby.sort((b,c)=>Math.abs(center(b)-cx)+Math.abs(b.bbox.y0-a.bbox.y1)-Math.abs(center(c)-cx)-Math.abs(c.bbox.y0-a.bbox.y1)||c.text.length-b.text.length);
  const author=nearby[0];
  // Prefer the complete author span over a contained fragment.
  const full=author&&nearby.filter(b=>b.bbox.x0<=author.bbox.x0&&b.bbox.x1>=author.bbox.x1&&Math.abs(b.bbox.y0-author.bbox.y0)<lineHeight(author)*.5).sort((b,c)=>c.text.length-b.text.length)[0];
  return {anchor:a,author:full};
 });
 // A numeric badge without author text cannot select the shelf row.
 let row=[];
 for(const seed of labels.filter(l=>l.author)){
  const h=lineHeight(seed.anchor);
  const group=labels.filter(l=>Math.abs(l.anchor.bbox.y0-seed.anchor.bbox.y0)<=Math.max(16,h*2));
  const score=group.filter(l=>l.author).length;
  if(score>row.filter(l=>l.author).length)row=group;
 }
 row.sort((a,b)=>center(a.anchor)-center(b.anchor));
 row=row.filter((l,i)=>!row.slice(0,i).some(p=>Math.abs(center(p.anchor)-center(l.anchor))<lineHeight(l.anchor)));
 if(row.length<minLabels)return [];
 const bottom=Math.min(height,Math.round(Math.max(...row.map(l=>l.anchor.bbox.y0+lineHeight(l.anchor)*6))));
 return row.map((l,i)=>{
  const a=l.anchor,left=i?(center(row[i-1].anchor)+center(a))/2:0,right=i+1<row.length?(center(a)+center(row[i+1].anchor))/2:width;
  const below=l.author?spans.filter(w=>center(w)>left&&center(w)<right&&w.bbox.y0>=l.author.bbox.y1&&w.bbox.y0<l.author.bbox.y1+lineHeight(a)*1.8):[];
  const volume=below.find(w=>/^(?:v\.?|권|c\.?)[1-9]\d*$/i.test(w.text))?.text.replace(/^(?:v\.?|권|c\.?)/i,'')||'';
  return {id:`V${String(i+1).padStart(2,'0')}`,classification:a.text,author:l.author?.text||'',volume,bbox:[Math.round(left),0,Math.round(right),bottom],labelBox:[a.bbox.x0,a.bbox.y0,a.bbox.x1,a.bbox.y1],confidence:a.confidence,confirmed:false};
 });
}
