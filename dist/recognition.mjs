import {readLabels,cleanLabel,isAuthor} from './labels.mjs';

// First find labels in the scene, then read each two-line label separately.
export async function recognizeLabels(engine,encoded,width,height,isCurrent=()=>true,prepare=null){
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
     const author=cleanLabel(line.text||'').replace(/^[|丨]+|[|丨]+$/g,'');
     if(isAuthor(author)&&line.confidence>=75){book.author=author;break;}
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
