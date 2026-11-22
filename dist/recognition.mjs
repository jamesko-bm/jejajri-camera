import {readLabels} from './labels.mjs';

// First find labels in the scene, then read each two-line label separately.
export async function recognizeLabels(engine,encoded,width,height,isCurrent=()=>true){
 await engine.setParameters({tessedit_pageseg_mode:'11'});
 const {data}=await engine.recognize(encoded,{}, {text:true,blocks:true});
 let books=readLabels(data.words||[],width,height);
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
 }
 return books;
}
