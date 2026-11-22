import {test} from 'node:test';import assert from 'node:assert/strict';
import {decreasingBooks,RecognitionGate,frameDifference,cameraCandidates,refineBookEdges} from './dist/camera-core.mjs';
import {readFileSync} from 'node:fs';
import {readLabels} from './dist/labels.mjs';
import {recognizeLabels} from './dist/recognition.mjs';
const book=(classification,id=classification,author='김10',volume='1')=>({id,classification,author,volume,bbox:[0,0,100,100]});
const word=(text,x,y,width=55,height=18)=>({text,confidence:95,bbox:{x0:x,y0:y,x1:x+width,y1:y+height}});
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
test('incomplete OCR retries automatically; slow cumulative motion invalidates',()=>{const gate=new RecognitionGate({threshold:5});const a=Uint8Array.from([20,50,100,160]);gate.tick(a,0);gate.tick(a,1100);gate.finish(gate.begin(),false,1200);assert.equal(gate.tick(a,3000).ready,false);assert.equal(gate.tick(a,4300).ready,true);gate.finish(gate.begin(),true,4400);for(let i=1;i<=8;i++)gate.tick(Uint8Array.from([20+i,50+i,100-i,160-i]),4500+i*180);assert.equal(gate.done,false);});
test('uniform exposure change and slight noise do not count as motion',()=>{assert.equal(frameDifference([20,50,80],[30,60,90]),0);assert.ok(frameDifference([20,50,80],[21,49,80])<1);});
test('visibility reset waits for in-flight OCR and never accepts its stale result',()=>{const gate=new RecognitionGate();const sig=[10,30,80];gate.tick(sig,0);gate.tick(sig,1100);const token=gate.begin();gate.reset();gate.tick(sig,2000);assert.equal(gate.tick(sig,3100).ready,false);assert.equal(gate.finish(token,true,3200),false);assert.equal(gate.tick(sig,3300).ready,true);});
test('camera candidates and image edge refinement retain bounds',()=>{const w=(text,x,y)=>({text,confidence:90,bbox:{x0:x,y0:y,x1:x+25,y1:y+15}});const rows=cameraCandidates([w('400',10,100),w('김10',10,125),w('300',100,100),w('박2',100,125)],200,200);assert.equal(rows.length,2);assert.equal(decreasingBooks(rows).flagged.length,1);const image={width:200,height:200,data:new Uint8ClampedArray(200*200*4)};const refined=refineBookEdges(rows,image);assert.equal(refined[0].bbox[0],0);assert.equal(refined[1].bbox[2],200);assert.ok(refined[0].bbox[2]<=refined[1].bbox[0]);assert.deepEqual(cameraCandidates([],200,200),[]);});
test('public interface has no upload, sample, capture, or analyze controls',()=>{const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');assert.doesNotMatch(html,/type=["']file|sample-top|id=["']analyze|id=["']ocr/);assert.match(html,/autoplay muted playsinline/);assert.match(app,/void startCamera\(\)/);assert.match(app,/audio:false/);assert.match(app,/setInterval\(tick,180\)/);});
