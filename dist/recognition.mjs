import {readLabels,cleanLabel,isAuthor,normalizeAuthor,parseShelfText,interpretCallNumber,circleAuthor} from './labels.mjs';

const DIGIT_WHITELIST='0123456789.';
const JAMO=Array.from({length:0x3163-0x3131+1},(_,i)=>String.fromCharCode(0x3131+i)).join('');
const SURNAMES='가간갈감강개경고곡공곽구국권금기길김나남노도라류리마맹모문미민박방배백버변봉부사삼상서석선설성소손송수시신심아안양엄여연염영오옥완왕요용우원유육윤은음이인임자장전정제조조주준지진차채천최추탁태하한허현호홍황';
const AUTHOR_WHITELIST=`0123456789${JAMO}${SURNAMES}`;

function preferFields(primary,extra){
 return {classification:primary.classification||extra.classification||'',author:primary.author||extra.author||''};
}

function preferClass(a,b){
 if(!a)return b||'';
 if(!b||a===b)return a;
 if(b.startsWith(`${a}.`))return b;
 if(a.startsWith(`${b}.`))return a;
 return '';
}

function mergeShelf(scene,strips){
 const items=strips.filter(s=>s.classification||s.author).map(s=>({classification:s.classification||'',author:s.author||'',volume:'',confidence:s.confidence||0,bbox:s.bbox,uncertain:!!s.uncertain||!s.classification||!s.author}));
 for(const book of scene){
  const cx=(book.bbox[0]+book.bbox[2])/2;
  const hit=items.find(s=>cx>=s.bbox[0]&&cx<=s.bbox[2]);
  if(!hit){items.push({classification:book.classification,author:book.author||'',volume:book.volume||'',confidence:book.confidence||0,bbox:book.bbox,uncertain:!book.author});continue;}
  const cls=preferClass(hit.classification,book.classification);
  if(!cls&&hit.classification&&book.classification&&hit.classification!==book.classification)hit.uncertain=true;
  else if(cls)hit.classification=cls;
  if(!hit.author)hit.author=book.author||'';
  if(book.volume)hit.volume=book.volume;
  hit.confidence=Math.max(hit.confidence,book.confidence||0);
  hit.uncertain=hit.uncertain||!hit.classification||!hit.author;
 }
 items.sort((a,b)=>a.bbox[0]-b.bbox[0]);
 const kept=items.flatMap(s=>{const ok=/^\d{3}(?:\.\d+)?$/.test(s.classification);if(!ok&&!s.author)return [];return [{...s,classification:ok?s.classification:'',uncertain:s.uncertain||!ok}];});
 if(kept.length<2)return [];
 return kept.map((s,i)=>({id:`V${String(i+1).padStart(2,'0')}`,classification:s.classification,author:s.author||'',volume:s.volume||'',bbox:s.bbox.map(Math.round),labelBox:s.bbox.map(Math.round),confidence:s.confidence||0,confirmed:false,uncertain:!!s.uncertain}));
}

async function recognizeShelf(engine,prepare,width,height,isCurrent){
 const layout=prepare.shelf();
 if(!layout?.strips?.length)return [];
 let books=[],words=[];
 if(layout.band){
  await engine.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  if(!isCurrent())return [];
  const {data:band}=await engine.recognize(layout.band.image,{}, {text:true,blocks:true});
  words=(band.words||[]).map(layout.band.mapWord);
  books=readLabels(words,width,height);
 }
 await engine.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
 const strips=[];
 for(const strip of layout.strips){
  if(!isCurrent())return [];
  if(!String(strip.image).startsWith('data:image'))continue;
  const lines=Array.isArray(strip.lines)?strip.lines:[];
  const gray=Array.isArray(strip.grayLines)?strip.grayLines:[];
  const readLine=async (image,whitelist)=>{
   await engine.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:whitelist});
   const {data:line}=await engine.recognize(image);
   return interpretCallNumber(line?.text||'');
  };
  let parsed={classification:'',author:''},topWasClass=false,topAuthor='',confidence=0;
  const take=async (image,whitelist,kind)=>{
   if(!image)return;
   if(!isCurrent())return;
   const fields=await readLine(image,whitelist);
   if(kind==='class'){if(fields.classification)parsed=preferFields(parsed,{classification:fields.classification,author:''});}
   else parsed=preferFields(parsed,fields);
  };
  if(lines[0]){await take(lines[0],DIGIT_WHITELIST,'class');topWasClass=!!parsed.classification;}
  if(lines[0]&&/^[17]\d{2}\.\d{2}$/.test(parsed.classification)){
   const open=await readLine(lines[0],'');
   if(/^00\d\.\d{2}$/.test(open.classification))parsed={classification:open.classification,author:parsed.author};
  }
  if(!isCurrent())return [];
  if(lines[1]){
   const authorLine=await readLine(lines[1],AUTHOR_WHITELIST);
   topAuthor=authorLine.author;
   parsed=preferFields(parsed,authorLine);
  }
  if(!parsed.author)await take(gray[1],AUTHOR_WHITELIST,'author');
  if(!parsed.author)await take(gray[1],'','author');
  // Digit-only recovery of 이 belongs to the author line, after the real cutter is tried.
  if(!parsed.author&&topAuthor&&!topWasClass)parsed=preferFields(parsed,{classification:'',author:topAuthor});
  // The author line is the lower one, but a swapped crop still has to land on the cutter.
  if(lines[0]&&!parsed.author&&!topWasClass){
   if(!isCurrent())return [];
   parsed=preferFields(parsed,await readLine(lines[0],AUTHOR_WHITELIST));
  }
  if(lines[1]&&!parsed.classification){
   if(!isCurrent())return [];
   parsed=preferFields(parsed,await readLine(lines[1],DIGIT_WHITELIST));
  }
  if(!parsed.classification||!parsed.author||/6$/.test(parsed.author)){
   if(!isCurrent())return [];
   await engine.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
   const {data}=await engine.recognize(strip.image);
   confidence=data.confidence||0;
   parsed=preferFields(parsed,interpretCallNumber(data.text||''));
   const circled=circleAuthor(data.text||'');
   if(circled&&(!parsed.author||parsed.author===circled.replace(/ㅇ$/,'6')||parsed.author===circled.slice(0,-1)))parsed.author=circled;
   const local=words.filter(w=>w.bbox&&(w.bbox.x0+w.bbox.x1)/2>=strip.bbox[0]&&(w.bbox.x0+w.bbox.x1)/2<=strip.bbox[2]).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0).map(w=>w.text).join(' ');
   const fromBand=parseShelfText(local);
   if(!parsed.classification&&/^\d{3}\.\d{2}$/.test(fromBand.classification))parsed.classification=fromBand.classification;
   if(!parsed.author&&fromBand.author)parsed.author=fromBand.author;
  }
  strips.push({classification:parsed.classification,author:parsed.author,uncertain:!/^\d{3}\.\d{2}$/.test(parsed.classification)||!parsed.author,bbox:strip.bbox,confidence});
 }
 return mergeShelf(books,strips);
}

// First find labels in the scene, then read each two-line label separately.
export async function recognizeLabels(engine,encoded,width,height,isCurrent=()=>true,prepare=null){
 if(prepare?.shelf){
  const shelf=await recognizeShelf(engine,prepare,width,height,isCurrent);
  if(!isCurrent())return [];
  if(shelf.length){
  await engine.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const {data:sceneData}=await engine.recognize(encoded,{}, {text:true,blocks:true});
  for(const book of readLabels(sceneData.words||[],width,height)){
   const box=book.labelBox||book.bbox,cx=(box[0]+box[2])/2;
   const hit=shelf.find(s=>cx>=s.bbox[0]&&cx<=s.bbox[2]);
   if(!hit||hit.classification||!/^\d{3}\.\d{2}$/.test(book.classification))continue;
   hit.classification=book.classification;
   hit.uncertain=!hit.author;
  }
  if(shelf.some(b=>/^\d{3}\.\d{2}$/.test(b.classification)))return shelf;
 }
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
     if(/^\d{3}(?:\.\d+)?$/.test(text)&&line.confidence>=80)votes.push(text);
    }
    if(votes.length===2&&votes[0]===votes[1]&&votes[0].length>=book.classification.length){book.classification=votes[0];book.uncertain=false;}
   }
   await engine.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  }
 }
 return books;
}
