import {prepareLine,improveCameraFocus,detectionTiles,analyzeShelf} from './image-preparation.mjs';
import {decreasingBooks,refineBookEdges} from './camera-core.mjs';
import {recognizeLabels} from './recognition.mjs';
const $=id=>document.getElementById(id),video=$('camera'),overlay=$('overlay'),context=overlay.getContext('2d');
const nativeFrame=document.createElement('canvas'),nativeContext=nativeFrame.getContext('2d');
const snapshot=document.createElement('canvas'),snapshotContext=snapshot.getContext('2d',{willReadFrequently:true});
const MAX_SHOTS=12;
let stream=null,worker=null,workerPromise=null,workerGeneration=0,connecting=false,closed=false,busy=false,job=0,view='start',shots=[];
function hint(text){$('hint').textContent=text;}
function showProcessing(on){$('processing').hidden=!on;}
function layout(){
 const stage=$('stage').getBoundingClientRect();
 const width=view==='camera'?video.videoWidth:snapshot.width,height=view==='camera'?video.videoHeight:snapshot.height,ratio=width/height;
 if(!Number.isFinite(ratio)||ratio<=0)return;
 let w=stage.width,h=w/ratio;
 if(h>stage.height){h=stage.height;w=h*ratio;}
 overlay.style.width=w+'px';overlay.style.height=h+'px';overlay.style.left=(stage.width-w)/2+'px';overlay.style.top=(stage.height-h)/2+'px';
}
window.addEventListener('resize',layout);
function setView(next){
 view=next;
 $('welcome').hidden=next!=='start';
 $('start-actions').hidden=next!=='start';
 $('camera-actions').hidden=next!=='camera';
 $('result-actions').hidden=next!=='result';
 $('shots').hidden=next!=='camera'||!shots.length;
 $('results').hidden=next!=='result';
 video.hidden=next!=='camera';
 overlay.hidden=next==='start'||next==='result';
 $('live-label').textContent=next==='camera'?'카메라':next==='result'?'결과':next==='processing'?'처리':'선택';
 showProcessing(next==='processing');
}
function paintBoxes(ctx,width,height,books){
 const flagged=new Set(decreasingBooks(books).flagged);
 ctx.strokeStyle='#ffe000';ctx.fillStyle='rgba(255,224,0,.12)';
 for(const book of books){
  if(!flagged.has(book))continue;
  const [x,y,r,b]=book.bbox||book.labelBox;
  const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(width,r),bottom=Math.min(height,b);
  const bw=Math.max(1,right-left),bh=Math.max(1,bottom-top);
  const weight=Math.max(3,Math.round(Math.min(bw,bh)/16));
  ctx.lineWidth=weight;
  const inset=weight/2;
  ctx.fillRect(left,top,bw,bh);
  ctx.strokeRect(left+inset,top+inset,Math.max(1,bw-weight),Math.max(1,bh-weight));
 }
}
function canvasesFromSource(source){
 const w=source.videoWidth||source.naturalWidth||source.width,h=source.videoHeight||source.naturalHeight||source.height;
 const native=document.createElement('canvas');native.width=w;native.height=h;native.getContext('2d').drawImage(source,0,0,w,h);
 const scale=Math.min(1,2400/Math.max(w,h));
 const snap=document.createElement('canvas');snap.width=Math.max(1,Math.round(w*scale));snap.height=Math.max(1,Math.round(h*scale));
 snap.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,snap.width,snap.height);
 return {native,snapshot:snap};
}
function cameraReady(){return !!(stream&&video.readyState>=2&&video.videoWidth);}
function renderShots(){
 const row=$('shots');row.replaceChildren();
 for(const shot of shots){
  const img=document.createElement('img');img.src=shot.snapshot.toDataURL('image/jpeg',.72);img.alt=`촬영 ${shots.indexOf(shot)+1}`;
  row.append(img);
 }
 row.hidden=view!=='camera'||!shots.length;
 $('finish').disabled=!shots.length||busy;
 $('finish').textContent=shots.length?`완료 (${shots.length})`:'완료';
}
function stopCamera(){
 stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
}
function goStart(){
 job++;busy=false;shots=[];$('results').replaceChildren();$('shots').replaceChildren();$('error').hidden=true;$('image-files').value='';
 stopCamera();setView('start');hint('이미지 추가 또는 카메라 사용을 눌러 주세요.');
}
function cameraError(error){
 $('error').hidden=false;$('capture').disabled=true;$('finish').disabled=true;showProcessing(false);
 const messages={NotAllowedError:'주소창의 카메라 권한을 허용해 주세요. 앱 안의 브라우저에서 열리지 않으면 Safari 또는 Chrome에서 이 주소를 열어 주세요.',NotFoundError:'연결된 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰이나 PC에서 열어 주세요.',NotReadableError:'다른 앱이 카메라를 사용 중일 수 있습니다. 해당 앱을 닫고 다시 연결해 주세요.',SecurityError:'HTTPS 주소의 일반 브라우저에서 열고 카메라 권한을 허용해 주세요.'};
 $('error-title').textContent='카메라 연결이 필요합니다';$('error-detail').textContent=messages[error.name]||error.message||'카메라를 연결하지 못했습니다.';
 hint('카메라를 연결한 뒤 여러 장을 찍고 완료를 눌러 주세요.');
}
function loadOCR(){
 if(window.Tesseract)return Promise.resolve();
 return new Promise((resolve,reject)=>{const old=document.getElementById('ocr-script');old?.remove();const script=document.createElement('script');script.id='ocr-script';script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(Error('OCR 다운로드를 확인해 주세요.'));document.head.append(script);});
}
function withTimeout(promise,ms=180000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OCR 응답을 기다리고 있습니다. 인터넷 연결을 확인해 주세요.')),ms);})]).finally(()=>clearTimeout(timer));}
async function getWorker(){
 if(worker)return worker;
 if(workerPromise)return workerPromise;
 const generation=++workerGeneration;
 workerPromise=(async()=>{await withTimeout(loadOCR());const pending=window.Tesseract.createWorker('kor+eng',1);pending.then(w=>{if(generation!==workerGeneration||closed)w.terminate();}).catch(()=>{});const created=await withTimeout(pending);if(generation!==workerGeneration||closed){await created.terminate();throw Error('인식 세션이 변경되었습니다.');}await created.setParameters({tessedit_pageseg_mode:'6'});worker=created;return created;})();
 try{return await workerPromise;}catch(error){workerGeneration++;throw error;}finally{workerPromise=null;}
}
async function resetWorker(){workerGeneration++;const previous=worker;worker=null;workerPromise=null;if(previous)await previous.terminate();}
function showPreview(snap){
 overlay.hidden=false;overlay.width=snap.width;overlay.height=snap.height;
 context.clearRect(0,0,overlay.width,overlay.height);context.drawImage(snap,0,0);layout();
}
function resultCanvas(snap,books){
 const canvas=document.createElement('canvas');canvas.width=snap.width;canvas.height=snap.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(snap,0,0);paintBoxes(ctx,snap.width,snap.height,books);
 return canvas;
}
async function processFrame(native,snap,token){
 nativeFrame.width=native.width;nativeFrame.height=native.height;nativeContext.drawImage(native,0,0);
 snapshot.width=snap.width;snapshot.height=snap.height;snapshotContext.drawImage(snap,0,0);
 const engine=await getWorker();if(token!==job||document.hidden)return null;
 const image=snapshotContext.getImageData(0,0,snapshot.width,snapshot.height),encoded=snapshot.toDataURL('image/png');
 const prepare=(book,part,variant)=>prepareLine(nativeFrame,book,part,image.width,undefined,variant);
 prepare.tiles=()=>detectionTiles(nativeFrame,image.width);prepare.shelf=()=>analyzeShelf(snapshot);
 const labels=await withTimeout(recognizeLabels(engine,encoded,image.width,image.height,()=>token===job&&!document.hidden,prepare));
 if(token!==job||document.hidden)return null;
 return refineBookEdges(labels,image);
}
async function processBatch(frames){
 if(!frames.length||busy)return;
 const token=++job;busy=true;stopCamera();setView('processing');hint('찍은 사진을 읽고 있습니다.');
 $('results').replaceChildren();
 let flagged=0,readable=0;
 try{
  for(let i=0;i<frames.length;i++){
   if(token!==job||document.hidden)return;
   hint(`${i+1}/${frames.length}장 읽고 있습니다.`);
   showPreview(frames[i].snapshot);
   const books=await processFrame(frames[i].native,frames[i].snapshot,token);
   if(token!==job||books==null)return;
   const order=decreasingBooks(books);
   if(order.flagged.length)flagged+=order.flagged.length;
   if(books.length>=2)readable+=1;
   overlay.hidden=true;context.clearRect(0,0,overlay.width,overlay.height);
   $('results').append(resultCanvas(frames[i].snapshot,books));
  }
  if(token!==job)return;
  setView('result');
  if(flagged)hint('노란 테두리가 잘못 꽂힌 책입니다.');
  else if(readable)hint('잘못 꽂힌 책이 없습니다.');
  else hint('번호가 선명하게 보이도록 다시 찍어 주세요.');
 }catch(error){
  if(token!==job)return;
  await resetWorker();setView('result');hint(error.message||'다시 찍어 주세요.');
 }finally{
  if(token===job)busy=false;
 }
}
async function filesToFrames(files){
 const frames=[];
 for(const file of files){
  if(!file.type.startsWith('image/')&&file.type)continue;
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}).catch(async()=>{
   const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}
  });
  frames.push(canvasesFromSource(bitmap));
  bitmap.close?.();
 }
 return frames;
}
async function startCamera(){
 if(connecting||closed)return;connecting=true;$('retry').disabled=true;$('error').hidden=true;$('capture').disabled=true;$('finish').disabled=true;
 setView('camera');hint('카메라 사용을 허용해 주세요.');
 stopCamera();
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Object.assign(Error('HTTPS 주소의 Chrome 또는 Safari에서 열어 주세요.'),{name:'SecurityError'});
  const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}}});
  if(closed){opened.getTracks().forEach(t=>t.stop());return;}
  stream=opened;await improveCameraFocus(stream.getVideoTracks()[0]);video.srcObject=stream;video.hidden=false;await video.play();
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(!closed&&view==='camera')cameraError({name:'NotReadableError'});});
  setView('camera');$('capture').disabled=false;renderShots();hint('책장을 비추고 촬영을 누른 뒤, 여러 장을 찍고 완료를 눌러 주세요.');layout();
 }catch(error){setView('camera');cameraError(error);}finally{connecting=false;$('retry').disabled=false;}
}
function captureShot(){
 if(view!=='camera'||busy||!cameraReady())return;
 if(shots.length>=MAX_SHOTS){hint(`한 번에 ${MAX_SHOTS}장까지 찍을 수 있습니다. 완료를 눌러 주세요.`);return;}
 shots.push(canvasesFromSource(video));renderShots();hint(`${shots.length}장을 찍었습니다. 더 찍거나 완료를 눌러 주세요.`);
}
$('add-images').onclick=()=>$('image-files').click();
$('image-files').onchange=async event=>{
 const files=[...event.target.files||[]].slice(0,MAX_SHOTS);
 event.target.value='';
 if(!files.length)return;
 try{
  const frames=await filesToFrames(files);
  if(!frames.length){hint('선택한 이미지 파일을 열 수 없습니다.');return;}
  void processBatch(frames);
 }catch(error){hint(error.message||'이미지를 열 수 없습니다.');}
};
$('use-camera').onclick=()=>{shots=[];void startCamera();};
$('capture').onclick=captureShot;
$('finish').onclick=()=>{if(!shots.length||busy)return;void processBatch(shots);};
$('cancel-camera').onclick=goStart;
$('again').onclick=goStart;
$('retry').onclick=()=>void startCamera();
$('error-home').onclick=goStart;
video.addEventListener('loadedmetadata',()=>{if(view==='camera'){$('capture').disabled=!cameraReady();layout();}});
video.addEventListener('resize',()=>{if(view==='camera')layout();});
window.addEventListener('pagehide',()=>{closed=true;job++;stopCamera();void resetWorker();});
window.addEventListener('pageshow',e=>{if(e.persisted){closed=false;if(view==='camera')void startCamera();}});
document.addEventListener('visibilitychange',()=>{
 if(view!=='camera')return;
 stream?.getTracks().forEach(t=>{t.enabled=!document.hidden;});
 if(document.hidden)video.pause();
 else video.play().catch(cameraError);
});
setView('start');
