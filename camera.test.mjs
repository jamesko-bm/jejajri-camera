import {test} from 'node:test';import assert from 'node:assert/strict';
import {decreasingBooks,RecognitionGate,frameDifference,cameraCandidates,refineBookEdges} from './dist/camera-core.mjs';
import {readFileSync} from 'node:fs';
import {readLabels,normalizeAuthor,parseShelfText,repairClass,interpretCallNumber} from './dist/labels.mjs';
import {recognizeLabels} from './dist/recognition.mjs';
import {improveCameraFocus} from './dist/image-preparation.mjs';
const book=(classification,id=classification,author='김10',volume='1')=>({id,classification,author,volume,bbox:[0,0,100,100]});
const word=(text,x,y,width=55,height=18)=>({text,confidence:95,bbox:{x0:x,y0:y,x1:x+width,y1:y+height}});
test('author spans never absorb text from the preceding book',()=>{
 const words=[word('004.59',150,100),word('예',120,125,24),word('김',150,125,20),word('94',172,125,20),word('ㄱ2',194,125,20),word('005.13',280,100),word('이211ㅋ',280,125)];
 assert.equal(readLabels(words,400,300)[0].author,'김94ㄱ2');
});
test('optional camera controls support continuous focus and tolerate rejection',async()=>{
 let applied;await improveCameraFocus({getCapabilities:()=>({focusMode:['manual','continuous']}),applyConstraints:async c=>{applied=c;}});
 assert.equal(applied.advanced[0].focusMode,'continuous');
 await improveCameraFocus({});await improveCameraFocus({getCapabilities:()=>({focusMode:['continuous']}),applyConstraints:async()=>{throw Error('unsupported');}});
});
test('expanded search recovers missing labels and cancels before the next tile',async()=>{
 const pair=[word('005.13',20,100),word('이211ㅋ',20,125),word('004.73',150,100),word('진91ㅋ',150,125)];
 let calls=0;const engine={setParameters:async()=>{},recognize:async()=>({data:{words:++calls===2?pair:[]}})};
 const prepare=()=>'';prepare.tiles=()=>[{image:'tile',mapWord:w=>w}];
 const result=await recognizeLabels(engine,'full',300,250,()=>true,prepare);
 assert.equal(result.length,2);assert.equal(decreasingBooks(result).flagged[0].classification,'005.13');
 calls=0;assert.deepEqual(await recognizeLabels(engine,'full',300,250,()=>false,prepare),[]);assert.equal(calls,1);
});
test('line recovery restores a missing author without changing known classification',async()=>{
 const pair=[word('005.13',20,100),word('004.73',150,100),word('진91ㅋ',150,125)];
 let calls=0;const parameters=[];const engine={setParameters:async p=>parameters.push(p),recognize:async()=>({data:++calls===1?{words:pair}:calls===3?{text:'이211ㅋ',confidence:89}:{words:[]}})};
 const result=await recognizeLabels(engine,'full',300,250,()=>true,()=> 'native-crop');
 assert.equal(result[0].author,'이211ㅋ');assert.equal(result[0].classification,'005.13');assert.equal(parameters[0].tessedit_char_whitelist,'');
});
test('blurred author digits that start with 0 are read as 이',()=>{
 assert.equal(normalizeAuthor('0164ㄷ'),'이64ㄷ');
 assert.equal(normalizeAuthor('01211ㅋ'),'이211ㅋ');
 assert.equal(normalizeAuthor('01211='),'이211ㅋ');
 assert.equal(normalizeAuthor('ol211='),'이211ㅋ');
 assert.equal(normalizeAuthor('012113'),'이211ㅋ');
 assert.equal(normalizeAuthor('1이64ㄷㄷ'),'이64ㄷ');
 assert.equal(repairClass('1004.59'),'004.59');
 assert.equal(repairClass('4945.19'),'');
 assert.equal(parseShelfText('UUs. 10 ol211=').classification,'');
 assert.equal(normalizeAuthor('004.59'),'');
 assert.deepEqual(parseShelfText('04.59 0164ㄷ'),{classification:'004.59',author:'이64ㄷ'});
 assert.deepEqual(parseShelfText('004 .59 김94ㄱ2'),{classification:'004.59',author:'김94ㄱ2'});
 assert.deepEqual(parseShelfText('004.59 0164ㄷ'),{classification:'004.59',author:'이64ㄷ'});
 assert.deepEqual(parseShelfText('004.59 김94ㄱ2'),{classification:'004.59',author:'김94ㄱ2'});
 assert.equal(parseShelfText('0064.59 Bais').classification,'');
 assert.equal(repairClass('05.13'),'005.13');
 assert.deepEqual(interpretCallNumber('005.13','이211ㅋ'),{classification:'005.13',author:'이211ㅋ'});
 assert.deepEqual(interpretCallNumber('004.73','진91ㅋ'),{classification:'004.73',author:'진91ㅋ'});
 assert.deepEqual(interpretCallNumber('004.59','김94ㄱ2'),{classification:'004.59',author:'김94ㄱ2'});
 assert.deepEqual(interpretCallNumber('김94ㄱ2','004.59'),{classification:'004.59',author:'김94ㄱ2'});
 assert.deepEqual(interpretCallNumber('1004.59','1이64ㄷㄷ'),{classification:'004.59',author:'이64ㄷ'});
 assert.deepEqual(interpretCallNumber('05.13\n이211ㅋ'),{classification:'005.13',author:'이211ㅋ'});
 assert.deepEqual(interpretCallNumber('04.59','0164ㄷ'),{classification:'004.59',author:'이64ㄷ'});
 assert.deepEqual(interpretCallNumber('4945.19','012113'),{classification:'',author:'이211ㅋ'});
 assert.equal(readLabels([word('004.59',20,100),word('0164ㄷ',20,125),word('004.73',180,100),word('진91ㅋ',180,125)],400,300)[0].author,'이64ㄷ');
});
test('real label format: jamo, split tokens, decimals and badges',()=>{
 const words=[word('004',20,100,26),word('.',47,101,3),word('59',52,100,20),word('이',20,127,14),word('64',36,124,20,25),word('ㄷ',58,129,12,12),word('005.13',150,108),word('이211ㅋ',150,134),word('004.73',280,116),word('진91ㅋ',280,142),word('신간',150,60),word('신간',280,60),...Array.from({length:5},(_,i)=>word('000',20+i*70,210,55,35))];
 const books=readLabels(words,400,300);
 assert.deepEqual(books.map(b=>b.classification),['004.59','005.13','004.73']);
 assert.deepEqual(books.map(b=>b.author),['이64ㄷ','이211ㅋ','진91ㅋ']);
 assert.deepEqual(decreasingBooks(books).flagged.map(b=>b.classification),['005.13']);
 assert.ok(books.every(b=>b.volume===''));
});
test('000 with an author is a real label; unsupported numeric badges alone are not',()=>{
 assert.deepEqual(readLabels([word('000',20,100),word('000',150,100)],300,250),[]);
 const books=readLabels([word('000',20,100),word('김1ㄱ',20,125),word('001',150,100),word('박2ㅎ',150,125)],300,250);
 assert.equal(books[0].classification,'000');assert.equal(decreasingBooks(books).complete,true);
});
test('same class compares full jamo author, including numeric suffix',()=>{
 assert.equal(decreasingBooks([book('004.59','a','김94ㅎ'),book('004.59','b','김94ㄱ2')]).flagged[0].id,'a');
 assert.equal(decreasingBooks([book('004.59','a','김94ㄱ2'),book('004.59','b','김94ㄱ10')]).flagged.length,0);
});
test('conflicting crop OCR blocks affected pairs, preserves an independently confirmed decrease',async()=>{
 const full=[word('004.59',20,100),word('이64ㄷ',20,125),word('004.54',150,100),word('나31ㅇ',150,125),word('005.13',280,100),word('이211ㅋ',280,125),word('004.73',410,100),word('진91ㅋ',410,125)];
 let calls=0;const engine={setParameters:async()=>{},recognize:async()=>({data:{words:calls++===0?full:[word(['004.59','004.5','005.13','004.73'][calls-2],20,100),word('김1ㄱ',20,125)]}})};
 const books=await recognizeLabels(engine,'image',500,300),result=decreasingBooks(books);
 assert.equal(books[1].uncertain,true);assert.equal(result.complete,false);assert.deepEqual(result.flagged.map(b=>b.classification),['005.13']);
 calls=0;const stale=await recognizeLabels(engine,'image',500,300,()=>false);assert.deepEqual(stale,[]);assert.equal(calls,1);
});
test('decreases mark the preceding left book',()=>{const books=['100','180','410','300','320','400','500','900','600','800'].map(n=>book(n));const result=decreasingBooks(books);assert.deepEqual(result.flagged.map(b=>b.id),['410','900']);assert.equal(result.complete,true);});
test('equal call numbers are allowed; each drop in a reverse run is marked',()=>{assert.equal(decreasingBooks([book('100'),book('100')]).flagged.length,0);assert.deepEqual(decreasingBooks(['300','200','100'].map(n=>book(n))).flagged.map(b=>b.id),['300','200']);});
test('natural author and volume comparisons; absent fields do not invent order',()=>{assert.equal(decreasingBooks([book('100','a','김10'),book('100','b','김2')]).flagged[0].id,'a');assert.equal(decreasingBooks([book('100','a','김10','2'),book('100','b','김10','1')]).flagged[0].id,'a');assert.equal(decreasingBooks([book('100','a',''),book('100','b')]).complete,false);assert.equal(decreasingBooks([book('100')]).complete,false);assert.equal(decreasingBooks([book('100','a','김1',''),book('100','b','김1','')]).complete,true);assert.equal(decreasingBooks([book('100','a','김1',''),book('100','b','김1','2')]).complete,false);});
test('automatic settle, recognition, completion, movement and stale results',()=>{const gate=new RecognitionGate();const still=new Uint8Array([20,50,100,160]),moved=new Uint8Array([160,100,50,20]);assert.equal(gate.tick(still,0).ready,false);assert.equal(gate.tick(still,1001).ready,true);const token=gate.begin();assert.equal(gate.tick(still,1200).ready,false);assert.equal(gate.finish(token,true,1400),true);assert.equal(gate.tick(still,2500).ready,false);assert.equal(gate.tick(moved,2700).moved,true);assert.equal(gate.done,false);assert.equal(gate.tick(moved,3800).ready,true);const next=gate.begin();gate.tick(still,3900);assert.equal(gate.finish(next,true,4000),false);assert.equal(gate.done,false);});
test('a captured frame can be interpreted while the camera moves',()=>{const gate=new RecognitionGate();const still=new Uint8Array([20,50,100,160]),moved=new Uint8Array([160,100,50,20]);gate.tick(still,0);gate.tick(still,1100);const token=gate.begin();gate.freeze();assert.equal(gate.tick(moved,1300).moved,false);assert.equal(gate.finish(token,true,1500),true);assert.equal(gate.done,true);assert.equal(gate.tick(moved,2000).moved,false);assert.equal(gate.done,true);assert.equal(gate.tick(still,2700).moved,true);assert.equal(gate.done,false);});
test('incomplete OCR retries automatically; slow cumulative motion invalidates',()=>{const gate=new RecognitionGate({threshold:5});const a=Uint8Array.from([20,50,100,160]);gate.tick(a,0);gate.tick(a,1100);gate.finish(gate.begin(),false,1200);assert.equal(gate.tick(a,3000).ready,false);assert.equal(gate.tick(a,4300).ready,true);gate.finish(gate.begin(),true,4400);for(let i=1;i<=8;i++)gate.tick(Uint8Array.from([20+i,50+i,100-i,160-i]),4500+i*180);assert.equal(gate.done,false);});
test('uniform exposure change and slight noise do not count as motion',()=>{assert.equal(frameDifference([20,50,80],[30,60,90]),0);assert.ok(frameDifference([20,50,80],[21,49,80])<1);});
test('visibility reset waits for in-flight OCR and never accepts its stale result',()=>{const gate=new RecognitionGate();const sig=[10,30,80];gate.tick(sig,0);gate.tick(sig,1100);const token=gate.begin();gate.reset();gate.tick(sig,2000);assert.equal(gate.tick(sig,3100).ready,false);assert.equal(gate.finish(token,true,3200),false);assert.equal(gate.tick(sig,3300).ready,true);});
test('camera candidates and image edge refinement retain bounds',()=>{
 const w=(text,x,y)=>({text,confidence:90,bbox:{x0:x,y0:y,x1:x+25,y1:y+15}});
 const rows=cameraCandidates([w('400',10,100),w('김10',10,125),w('300',100,100),w('박2',100,125)],200,200);
 assert.equal(rows.length,2);assert.equal(decreasingBooks(rows).flagged.length,1);
 const image={width:200,height:200,data:new Uint8ClampedArray(200*200*4)};
 const refined=refineBookEdges(rows,image);
 assert.ok(refined[0].bbox[2]<=refined[1].bbox[0]);
 assert.ok(refined[0].bbox[2]-refined[0].bbox[0]<160);
 assert.ok(refined[0].bbox[0]>=0&&refined[1].bbox[2]<=200);
 assert.deepEqual(cameraCandidates([],200,200),[]);
});
test('yellow boxes follow the painted book rectangle, not just the label',()=>{
 const width=200,height=180,image={width,height,data:new Uint8ClampedArray(width*height*4)};
 const fill=(x,y,r,b,rgb)=>{for(let yy=y;yy<b;yy++)for(let xx=x;xx<r;xx++){const i=(yy*width+xx)*4;image.data[i]=rgb[0];image.data[i+1]=rgb[1];image.data[i+2]=rgb[2];image.data[i+3]=255;}};
 fill(30,20,80,160,[180,70,50]);fill(86,25,140,160,[50,90,170]);
 const books=[
  {id:'a',classification:'400',author:'김10',volume:'1',bbox:[40,90,70,120],labelBox:[40,90,70,120]},
  {id:'b',classification:'300',author:'박2',volume:'1',bbox:[100,95,130,125],labelBox:[100,95,130,125]},
 ];
 const refined=refineBookEdges(books,image),[x,y,r,d]=refined[0].bbox,second=refined[1].bbox;
 assert.ok(x<=33&&r>=77,String(refined[0].bbox));
 assert.ok(y<=26&&d>=154,String(refined[0].bbox));
 assert.ok(second[0]<=90&&second[2]>=136,String(second));
 assert.ok(second[1]<=30&&second[3]>=154,String(second));
 assert.ok(refined[0].bbox[2]<=refined[1].bbox[0]+2);
});
test('start offers image add and camera, then process with a blinking status and yellow book borders',()=>{
 const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
 assert.match(html,/id=["']add-images"/);assert.match(html,/>이미지 추가</);
 assert.match(html,/id=["']use-camera"/);assert.match(html,/>카메라 사용</);
 assert.match(html,/id=["']image-files"[^>]*type=["']file"/);assert.match(html,/multiple/);
 assert.match(html,/id=["']capture"/);assert.match(html,/>촬영</);
 assert.match(html,/id=["']finish"/);assert.match(html,/>완료</);
 assert.match(html,/\[처리 중\]/);assert.match(html,/autoplay muted playsinline/);
 assert.match(app,/setView\('start'\);\s*$/);assert.match(app,/\$\('use-camera'\)\.onclick/);
 assert.match(app,/createImageBitmap|image-files/);assert.match(app,/processBatch/);
 assert.match(app,/audio:false/);assert.match(app,/#ffe000/);assert.match(app,/strokeRect/);
 assert.doesNotMatch(app,/setInterval\(tick/);
});
