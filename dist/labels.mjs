// Keep compatibility jamo (ㄱ, ㅋ, …); NFKC would change their ordering.
export const cleanLabel = text => String(text).normalize('NFC').replace(/\s+/g,'').replace(/[．。]/g,'.');
export const isAuthor = text => /^[가-힣A-Za-z]+\d+[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9.-]*$/.test(text);
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
 const authors=spans.filter(w=>isAuthor(w.text));
 let anchors=spans.filter(w=>/^\d{3}(?:\.\d+)?$/.test(w.text));
 // Prefer a full decimal to an overlapping integer fragment.
 anchors=anchors.filter(a=>!anchors.some(b=>b!==a&&b.text.length>a.text.length&&b.bbox.x0<=a.bbox.x0&&b.bbox.x1>=a.bbox.x1&&Math.abs(b.bbox.y0-a.bbox.y0)<3));
 const labels=anchors.map(a=>{
  const h=lineHeight(a),cx=center(a);
  const nearby=authors.filter(b=>b.bbox.y0>=a.bbox.y1-h*.25&&b.bbox.y0<=a.bbox.y1+h*1.8&&Math.abs(center(b)-cx)<=Math.max(a.bbox.x1-a.bbox.x0,b.bbox.x1-b.bbox.x0)*.65);
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
  // A third line must explicitly say v./권; bare 000 is a shelf badge.
  const volume=l.author?spans.find(w=>/^(?:v\.?|권)[1-9]\d*$/i.test(w.text)&&center(w)>left&&center(w)<right&&w.bbox.y0>=l.author.bbox.y1&&w.bbox.y0<l.author.bbox.y1+lineHeight(a)*1.6)?.text.replace(/^(?:v\.?|권)/i,'')||'':'';
  return {id:`V${String(i+1).padStart(2,'0')}`,classification:a.text,author:l.author?.text||'',volume,bbox:[Math.round(left),0,Math.round(right),bottom],labelBox:[a.bbox.x0,a.bbox.y0,a.bbox.x1,a.bbox.y1],confidence:a.confidence,confirmed:false};
 });
}
