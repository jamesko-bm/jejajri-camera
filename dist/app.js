import {prepareLine,improveCameraFocus,detectionTiles,analyzeShelf} from './image-preparation.mjs';
import {decreasingBooks,refineBookEdges} from './camera-core.mjs';
import {recognizeLabels} from './recognition.mjs';
const $=id=>document.getElementById(id),video=$('camera'),overlay=$('overlay'),context=overlay.getContext('2d');
const nativeFrame=document.createElement('canvas'),nativeContext=nativeFrame.getContext('2d');
const snapshot=document.createElement('canvas'),snapshotContext=snapshot.getContext('2d',{willReadFrequently:true});
let stream=null,worker=null,workerPromise=null,workerGeneration=0,connecting=false,closed=false,busy=false,showingStill=false,job=0;
const readButton=$('read-shelf');
function hint(text){$('hint').textContent=text;}
function showProcessing(on){$('processing').hidden=!on;}
function layout(){
 const stage=$('stage').getBoundingClientRect();
 const width=showingStill?snapshot.width:video.videoWidth,height=showingStill?snapshot.height:video.videoHeight,ratio=width/height;
 if(!Number.isFinite(ratio)||ratio<=0)return;
 let w=stage.width,h=w/ratio;
 if(h>stage.height){h=stage.height;w=h*ratio;}
 overlay.style.width=w+'px';overlay.style.height=h+'px';overlay.style.left=(stage.width-w)/2+'px';overlay.style.top=(stage.height-h)/2+'px';
}
window.addEventListener('resize',layout);
function cameraReady(){return !!(stream&&video.readyState>=2&&video.videoWidth);}
function showLive(){
 showingStill=false;overlay.hidden=true;context.clearRect(0,0,overlay.width,overlay.height);
 readButton.textContent='책장 읽기';readButton.disabled=busy||!cameraReady();
 showProcessing(false);hint('책장을 비춘 뒤 책장 읽기를 눌러 주세요.');layout();
}
function paintStill(books=[]){
 showingStill=true;overlay.hidden=false;overlay.width=snapshot.width;overlay.height=snapshot.height;
 context.clearRect(0,0,overlay.width,overlay.height);context.drawImage(snapshot,0,0);
 const flagged=new Set(decreasingBooks(books).flagged),weight=Math.max(6,Math.round(snapshot.width/160));
 context.lineWidth=weight;context.strokeStyle='#ffe000';context.fillStyle='rgba(255,224,0,.28)';
 for(const book of books){
  if(!flagged.has(book))continue;
  const [x,y,r,b]=book.labelBox||book.bbox,pad=Math.max(6,Math.round((b-y)*.08));
  const left=Math.max(0,x-pad),top=Math.max(0,y-pad),right=Math.min(snapshot.width,r+pad),bottom=Math.min(snapshot.height,b+pad);
  context.fillRect(left,top,right-left,bottom-top);context.strokeRect(left,top,right-left,bottom-top);
 }
 layout();
}
function cameraError(error){
 $('error').hidden=false;readButton.disabled=true;showProcessing(false);
 const messages={NotAllowedError:'주소창의 카메라 권한을 허용해 주세요. 앱 안의 브라우저에서 열리지 않으면 Safari 또는 Chrome에서 이 주소를 열어 주세요.',NotFoundError:'연결된 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰이나 PC에서 열어 주세요.',NotReadableError:'다른 앱이 카메라를 사용 중일 수 있습니다. 해당 앱을 닫고 다시 연결해 주세요.',SecurityError:'HTTPS 주소의 일반 브라우저에서 열고 카메라 권한을 허용해 주세요.'};
 $('error-title').textContent='카메라 연결이 필요합니다';$('error-detail').textContent=messages[error.name]||error.message||'카메라를 연결하지 못했습니다.';
 hint('카메라가 연결되면 책장 읽기를 눌러 주세요.');
}
function loadOCR(){
 if(window.Tesseract)return Promise.resolve();
 return new Promise((resolve,reject)=>{const old=document.getElementById('ocr-script');old?.remove();const script=document.createElement('script');script.id='ocr-script';script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(Error('OCR 다운로드를 확인해 주세요.'));document.head.append(script);});
}
function withTimeout(promise,ms=120000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OCR 응답을 기다리고 있습니다. 인터넷 연결을 확인해 주세요.')),ms);})]).finally(()=>clearTimeout(timer));}
async function getWorker(){
 if(worker)return worker;
 if(workerPromise)return workerPromise;
 const generation=++workerGeneration;
 workerPromise=(async()=>{await withTimeout(loadOCR());const pending=window.Tesseract.createWorker('kor+eng',1);pending.then(w=>{if(generation!==workerGeneration||closed)w.terminate();}).catch(()=>{});const created=await withTimeout(pending);if(generation!==workerGeneration||closed){await created.terminate();throw Error('인식 세션이 변경되었습니다.');}await created.setParameters({tessedit_pageseg_mode:'6'});worker=created;return created;})();
 try{return await workerPromise;}catch(error){workerGeneration++;throw error;}finally{workerPromise=null;}
}
async function resetWorker(){workerGeneration++;const previous=worker;worker=null;workerPromise=null;if(previous)await previous.terminate();}
function captureFrame(){
 nativeFrame.width=video.videoWidth;nativeFrame.height=video.videoHeight;nativeContext.drawImage(video,0,0);
 const scale=Math.min(1,2000/Math.max(video.videoWidth,video.videoHeight));
 snapshot.width=Math.max(1,Math.round(video.videoWidth*scale));snapshot.height=Math.max(1,Math.round(video.videoHeight*scale));
 snapshotContext.drawImage(video,0,0,snapshot.width,snapshot.height);
}
async function readShelf(){
 if(busy||!cameraReady())return;
 const token=++job;busy=true;readButton.disabled=true;showProcessing(true);hint('찍은 사진을 읽고 있습니다.');
 captureFrame();paintStill();
 try{
  const engine=await getWorker();if(token!==job||document.hidden)return;
  const image=snapshotContext.getImageData(0,0,snapshot.width,snapshot.height),encoded=snapshot.toDataURL('image/png');
  const prepare=(book,part,variant)=>prepareLine(nativeFrame,book,part,image.width,undefined,variant);
  prepare.tiles=()=>detectionTiles(nativeFrame,image.width);prepare.shelf=()=>analyzeShelf(snapshot);
  const labels=await withTimeout(recognizeLabels(engine,encoded,image.width,image.height,()=>token===job&&!document.hidden,prepare));
  if(token!==job||document.hidden)return;
  const books=refineBookEdges(labels,image),order=decreasingBooks(books);
  paintStill(books);readButton.textContent='다시 찍기';
  if(order.flagged.length)hint('노란 상자가 잘못 꽂힌 번호입니다.');
  else if(order.complete)hint('잘못 꽂힌 번호가 없습니다.');
  else hint('번호가 선명하게 보이도록 다시 찍어 주세요.');
 }catch(error){
  if(token!==job)return;
  await resetWorker();readButton.textContent='다시 찍기';hint(error.message||'다시 찍어 주세요.');
 }finally{
  if(token===job){busy=false;showProcessing(false);readButton.disabled=false;}
 }
}
async function startCamera(){
 if(connecting||closed)return;connecting=true;$('retry').disabled=true;$('error').hidden=true;readButton.disabled=true;hint('카메라 사용을 허용해 주세요.');
 stream?.getTracks().forEach(t=>t.stop());stream=null;showingStill=false;overlay.hidden=true;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Object.assign(Error('HTTPS 주소의 Chrome 또는 Safari에서 열어 주세요.'),{name:'SecurityError'});
  const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}}});
  if(closed){opened.getTracks().forEach(t=>t.stop());return;}
  stream=opened;await improveCameraFocus(stream.getVideoTracks()[0]);video.srcObject=stream;await video.play();layout();
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(!closed)cameraError({name:'NotReadableError'});});
  showLive();
 }catch(error){cameraError(error);}finally{connecting=false;$('retry').disabled=false;}
}
readButton.onclick=()=>{if(busy)return;if(showingStill){showLive();return;}void readShelf();};
$('retry').onclick=startCamera;
video.addEventListener('loadedmetadata',()=>{if(!showingStill){readButton.disabled=!cameraReady();layout();}});
video.addEventListener('resize',()=>{if(!showingStill)layout();});
window.addEventListener('pagehide',()=>{closed=true;job++;stream?.getTracks().forEach(t=>t.stop());void resetWorker();});
window.addEventListener('pageshow',e=>{if(e.persisted){closed=false;void startCamera();}});
document.addEventListener('visibilitychange',()=>{
 job++;busy=false;stream?.getTracks().forEach(t=>{t.enabled=!document.hidden;});
 if(document.hidden){video.pause();showProcessing(false);readButton.disabled=true;hint('화면으로 돌아오면 이어서 찍을 수 있습니다.');}
 else if(stream){video.play().catch(cameraError);if(!showingStill)showLive();else{showProcessing(false);readButton.disabled=false;}}
});
void startCamera();
