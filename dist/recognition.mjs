import {readLabels,cleanLabel,normalizeAuthor,parseShelfText,interpretCallNumber,circleAuthor,preferClass as pickClass,preferAuthor,isFullClass,isCollectionBadge,snapShelfClasses,snapShelfAuthors} from './labels.mjs';

const DIGIT_WHITELIST='0123456789.';
const JAMO=Array.from({length:0x3163-0x3131+1},(_,i)=>String.fromCharCode(0x3131+i)).join('');
const AUTHOR_WHITELIST=`0123456789가김나박이정최조한신슈스원${JAMO}`;

function preferFields(primary,extra){
 return {
  classification:pickClass(primary.classification,extra.classification)||primary.classification||'',
  author:preferAuthor(primary.author,extra.author)||primary.author||extra.author||'',
  volume:primary.volume||extra.volume||'',
  copy:primary.copy||extra.copy||''
 };
}
function asAuthor(fields){
 return {classification:'',author:fields.author||'',volume:fields.volume||'',copy:fields.copy||''};
}

function reconcileClass(a,b){
 if(!a)return b||'';
 if(!b||a===b)return a;
 const picked=pickClass(a,b);
 if(isCollectionBadge(a)||isCollectionBadge(b))return picked;
 if(b.startsWith(`${a}.`))return b;
 if(a.startsWith(`${b}.`))return a;
 if(a!==b)return '';
 return picked;
}

function mergeShelf(scene,strips){
 const items=strips.map(s=>({classification:s.classification||'',author:s.author||'',volume:s.volume||'',copy:s.copy||'',confidence:s.confidence||0,bbox:s.bbox,uncertain:!!s.uncertain||!s.classification||!s.author}));
 for(const book of scene){
  const cx=(book.bbox[0]+book.bbox[2])/2;
  const hit=items.find(s=>cx>=s.bbox[0]&&cx<=s.bbox[2]);
  if(!hit){items.push({classification:book.classification,author:book.author||'',volume:book.volume||'',copy:book.copy||'',confidence:book.confidence||0,bbox:book.bbox,uncertain:!book.author});continue;}
  const cls=reconcileClass(hit.classification,book.classification);
  if(!cls&&hit.classification&&book.classification&&hit.classification!==book.classification)hit.uncertain=true;
  else if(cls)hit.classification=cls;
  if(!hit.author)hit.author=book.author||'';
  if(book.volume)hit.volume=book.volume;
  if(book.copy)hit.copy=book.copy;
  hit.confidence=Math.max(hit.confidence,book.confidence||0);
  hit.uncertain=hit.uncertain||!hit.classification||!hit.author;
 }
 items.sort((a,b)=>a.bbox[0]-b.bbox[0]);
 if(!items.length)return [];
 return snapShelfAuthors(snapShelfClasses(items)).map((s,i)=>({id:`V${String(i+1).padStart(2,'0')}`,classification:s.classification,author:s.author||'',volume:s.volume||'',copy:s.copy||'',bbox:s.bbox.map(Math.round),labelBox:s.bbox.map(Math.round),confidence:s.confidence||0,confirmed:false,uncertain:!!s.uncertain||!isFullClass(s.classification)||!s.author}));
}

async function recognizeShelf(engine,prepare,width,height,isCurrent){
 const layout=prepare.shelf();
 if(!layout?.strips?.length)return [];
 const books=[],words=[];
 const strips=[];
 for(const strip of layout.strips){
  if(!isCurrent())return [];
  if(!String(strip.image).startsWith('data:image'))continue;
  const lines=Array.isArray(strip.lines)?strip.lines:[];
  const gray=Array.isArray(strip.grayLines)?strip.grayLines:[];
  const invert=Array.isArray(strip.invertLines)?strip.invertLines:[];
  const readLine=async (image,whitelist,psm='7')=>{
   if(!image||!isCurrent())return {classification:'',author:'',volume:'',copy:''};
   await engine.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:whitelist});
   const {data:line}=await engine.recognize(image);
   return interpretCallNumber(line?.text||'');
  };
  let parsed={classification:'',author:'',volume:'',copy:''},topWasClass=false,topAuthor='',confidence=0;
  const take=async (image,whitelist,kind,psm='7')=>{
   if(!image||!isCurrent())return;
   const fields=await readLine(image,whitelist,psm);
   if(kind==='class'){if(fields.classification)parsed=preferFields(parsed,{classification:fields.classification,author:'',volume:'',copy:''});}
   else parsed=preferFields(parsed,asAuthor(fields));
  };
  if(lines[0]){await take(lines[0],'','class');topWasClass=!!parsed.classification;}
  if(lines[0]&&!isFullClass(parsed.classification))await take(gray[0],'','class');
  if(lines[0]&&!isFullClass(parsed.classification))await take(lines[0],DIGIT_WHITELIST,'class');
  if(lines[0]&&/^[17]\d{2}\.\d{1,4}$/.test(parsed.classification)){
   const open=await readLine(lines[0],'');
   if(/^00\d\.\d{1,4}$/.test(open.classification))parsed={...parsed,classification:open.classification};
  }
  if(!isCurrent())return [];
  if(lines[1]){
   const authorLine=asAuthor(await readLine(lines[1],''));
   topAuthor=authorLine.author;
   parsed=preferFields(parsed,authorLine);
   const circled=circleAuthor(authorLine.author);
   if(circled)parsed.author=circled;
  }
  if(!parsed.author)await take(gray[1],'','author');
  if(!parsed.author)await take(lines[1],'','author','8');
  for(let i=2;i<lines.length;i++)parsed=preferFields(parsed,asAuthor(await readLine(lines[i],'')));
  if(!parsed.author&&topAuthor&&!topWasClass)parsed=preferFields(parsed,{classification:'',author:topAuthor,volume:'',copy:''});
  if(lines[1]&&!isFullClass(parsed.classification)){
   if(!isCurrent())return [];
   parsed=preferFields(parsed,await readLine(lines[1],DIGIT_WHITELIST));
  }
  if(!isCurrent())return [];
  await engine.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  const {data}=await engine.recognize(strip.image);
  confidence=data.confidence||0;
  const whole=interpretCallNumber(data.text||'');
  parsed=preferFields(parsed,whole);
  const circled=circleAuthor(data.text||'');
  if(circled)parsed.author=preferAuthor(parsed.author,circled)||circled;
  strips.push({classification:parsed.classification,author:parsed.author,volume:parsed.volume||'',copy:parsed.copy||'',uncertain:!isFullClass(parsed.classification)||!parsed.author,bbox:strip.bbox,confidence});
 }
 return mergeShelf(books,strips);
}

function usableShelf(shelf){
 return shelf.filter(b=>isFullClass(b.classification)||b.author).length>=2;
}

// First find labels in the scene, then read each two-line label separately.
export async function recognizeLabels(engine,encoded,width,height,isCurrent=()=>true,prepare=null){
 if(prepare?.shelf){
  const shelf=await recognizeShelf(engine,prepare,width,height,isCurrent);
  if(!isCurrent())return [];
  if(usableShelf(shelf)||shelf.length)return shelf;
 }
 await engine.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
 const {data}=await engine.recognize(encoded,{}, {text:true,blocks:true});
 let books=readLabels(data.words||[],width,height);
 if(books.length<2&&prepare?.tiles){
  const words=[];
  for(const tile of prepare.tiles()){
   if(!isCurrent())return [];
   const {data:detail}=await engine.recognize(tile.image,{}, {text:true,blocks:true});
   for(const w of detail.words||[]){
    const mapped=tile.mapWord(w);
    const duplicate=words.find(v=>v.text===mapped.text&&Math.abs(v.bbox.x0-mapped.bbox.x0)<8&&Math.abs(v.bbox.y0-mapped.bbox.y0)<8);
    if(!duplicate)words.push(mapped);
   }
  }
  books=readLabels(words,width,height);
 }
 await engine.setParameters({tessedit_pageseg_mode:'6'});
 for(const book of books){
  if(!isCurrent())return [];
  const [x,y,r,b]=book.labelBox,h=b-y;
  const left=Math.max(book.bbox[0],Math.floor(x-h*.35)),top=Math.max(0,Math.floor(y-h*.25));
  const right=Math.min(book.bbox[2],Math.ceil(r+h*.65)),bottom=Math.min(height,Math.ceil(b+h*2));
  const {data:detail}=await engine.recognize(encoded,{rectangle:{left,top,width:right-left,height:bottom-top}},{text:true,blocks:true});
  const parsed=readLabels(detail.words||[],width,height,1)[0];
  if(parsed?.author&&parsed.confidence>=70){
   // Conflicting readings must not turn a truncated number into a confident
   // decrease. Keep the observation but block comparisons involving this book.
   book.uncertain=parsed.classification!==book.classification;
   book.author=parsed.author;book.volume=parsed.volume;
  }
  if(book.confidence<70)book.uncertain=true;
  if(prepare){
   if(!isCurrent())return [];
   // Separate text lines avoid language confusion and preserve native pixels.
   if(!book.author){
    await engine.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
    for(let variant=0;variant<2;variant++){
     if(!isCurrent())return [];
     const {data:line}=await engine.recognize(prepare(book,'author',variant),{}, {text:true,blocks:true});
     const author=normalizeAuthor(line.text||'');
     if(author&&line.confidence>=75){book.author=author;break;}
    }
   }
   if(book.uncertain){
    await engine.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.'});
    const votes=[];
    for(let variant=0;variant<2;variant++){
     if(!isCurrent())return [];
     const {data:line}=await engine.recognize(prepare(book,'number',variant),{}, {text:true,blocks:true});
     const text=cleanLabel(line.text||'');
     if(/^\d{3}(?:\.\d{1,4})?$/.test(text)&&line.confidence>=80)votes.push(text);
    }
    if(votes.length===2&&votes[0]===votes[1]&&votes[0].length>=book.classification.length){book.classification=votes[0];book.uncertain=false;}
   }
   await engine.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  }
 }
 return books;
}
