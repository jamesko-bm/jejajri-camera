import {readLabels,cleanLabel,normalizeAuthor,parseShelfText,interpretCallNumber,interpretAuthorLine,extractAuthorMark,circleAuthor,preferClass as pickClass,preferAuthor,scrubAuthor,isAuthor,isFullClass,isCollectionBadge,snapShelfClasses,snapShelfAuthors} from './labels.mjs';

const DIGIT_WHITELIST='0123456789.';
const JAMO=Array.from({length:0x3163-0x3131+1},(_,i)=>String.fromCharCode(0x3131+i)).join('');
const AUTHOR_WHITELIST=`0123456789가김나박이정최조한신슈스원${JAMO}`;

function preferFields(primary,extra){
 const classification=pickClass(primary.classification,extra.classification)||primary.classification||extra.classification||'';
 const volume=primary.volume||extra.volume||'';
 const copy=primary.copy||extra.copy||'';
 const a=scrubAuthor(primary.author,classification,volume,copy);
 const b=scrubAuthor(extra.author,classification,volume,copy);
 return {
  classification,
  author:preferAuthor(a,b)||a||b||'',
  volume,
  copy
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
 return snapShelfAuthors(snapShelfClasses(items)).map((s,i)=>{
  const author=scrubAuthor(s.author,s.classification,s.volume,s.copy);
  return {id:`V${String(i+1).padStart(2,'0')}`,classification:s.classification,author,volume:s.volume||'',copy:s.copy||'',bbox:s.bbox.map(Math.round),labelBox:s.bbox.map(Math.round),confidence:s.confidence||0,confirmed:false,uncertain:!!s.uncertain||!isFullClass(s.classification)||!isAuthor(author||'')};
 });
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
  const readLine=async (image,whitelist,psm='7')=>{
   if(!image||!isCurrent())return {classification:'',author:'',volume:'',copy:''};
   await engine.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:whitelist});
   const {data:line}=await engine.recognize(image);
   return interpretCallNumber(line?.text||'');
  };
  const readAuthor=async (image,psm='7',whitelist='')=>{
   if(!image||!isCurrent())return {classification:'',author:'',volume:'',copy:''};
   await engine.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:whitelist});
   const {data:line}=await engine.recognize(image);
   return interpretAuthorLine(line?.text||'');
  };
  let parsed={classification:'',author:'',volume:'',copy:''},confidence=0;
  const takeClass=async (image,whitelist,psm='7')=>{
   if(!image||!isCurrent())return;
   const fields=await readLine(image,whitelist,psm);
   parsed=preferFields(parsed,{classification:fields.classification,author:fields.author,volume:fields.volume,copy:fields.copy});
  };
  const takeAuthor=async (image,psm='7',whitelist='')=>{
   if(!image||!isCurrent())return;
   parsed=preferFields(parsed,asAuthor(await readAuthor(image,psm,whitelist)));
  };
  if(!isCurrent())return [];
  if(gray[0])await takeClass(gray[0],'');
  if(lines[0]&&!isFullClass(parsed.classification))await takeClass(lines[0],'');
  if(lines[0]&&!isFullClass(parsed.classification))await takeClass(lines[0],DIGIT_WHITELIST);
  if(gray[0]&&/^[17]\d{2}\.\d{1,4}$/.test(parsed.classification)){
   const open=await readLine(gray[0],'');
   if(/^00\d\.\d{1,4}$/.test(open.classification))parsed={...parsed,classification:open.classification};
  }
  if(!isCurrent())return [];
  if(lines[1])await takeAuthor(lines[1]);
  if(lines[1])await takeAuthor(lines[1],'8');
  if(gray[1])await takeAuthor(gray[1],'7',AUTHOR_WHITELIST);
  if(gray[1])await takeAuthor(gray[1],'8',AUTHOR_WHITELIST);
  if(!isAuthor(parsed.author)&&gray[1])await takeAuthor(gray[1]);
  if(!isAuthor(parsed.author)&&gray[1])await takeAuthor(gray[1],'8');
  if(!parsed.author&&lines[0])await takeAuthor(gray[0]||lines[0]);
  for(let i=2;i<Math.max(lines.length,gray.length);i++){
   parsed=preferFields(parsed,asAuthor(await readAuthor(gray[i]||lines[i])));
   if(lines[i])parsed=preferFields(parsed,asAuthor(await readAuthor(lines[i])));
  }
  if(!isCurrent())return [];
  let wholeText='';
  const takeWhole=async image=>{
   if(!image||!isCurrent())return;
   await engine.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
   const {data}=await engine.recognize(image);
   confidence=Math.max(confidence,data.confidence||0);
   wholeText=`${wholeText}\n${data.text||''}`;
   const whole=interpretCallNumber(data.text||'');
   if(!isFullClass(parsed.classification)&&whole.classification)parsed=preferFields(parsed,whole);
   else if(whole.author||whole.volume||whole.copy)parsed=preferFields(parsed,{classification:'',author:whole.author,volume:whole.volume,copy:whole.copy});
  };
  if(strip.grayImage)await takeWhole(strip.grayImage);
  await takeWhole(strip.image);
  const circledWhole=scrubAuthor(circleAuthor(wholeText),parsed.classification,parsed.volume,parsed.copy);
  if(circledWhole)parsed.author=preferAuthor(parsed.author,circledWhole)||circledWhole;
  if(!parsed.author)parsed.author=scrubAuthor(extractAuthorMark(wholeText),parsed.classification,parsed.volume,parsed.copy);
  parsed.author=scrubAuthor(parsed.author,parsed.classification,parsed.volume,parsed.copy);
  strips.push({classification:parsed.classification,author:parsed.author,volume:parsed.volume||'',copy:parsed.copy||'',uncertain:!isFullClass(parsed.classification)||!isAuthor(parsed.author||''),bbox:strip.bbox,confidence});
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
