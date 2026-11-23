import {prepareLine,improveCameraFocus,detectionTiles,analyzeShelf} from './image-preparation.mjs';
import {RecognitionGate,decreasingBooks,refineBookEdges} from './camera-core.mjs';
import {recognizeLabels} from './recognition.mjs';
const $=id=>document.getElementById(id),video=$('camera'),overlay=$('overlay'),context=overlay.getContext('2d');
const nativeFrame=document.createElement('canvas'),nativeContext=nativeFrame.getContext('2d');
const snapshot=document.createElement('canvas'),snapshotContext=snapshot.getContext('2d',{willReadFrequently:true});
const motion=document.createElement('canvas');motion.width=80;motion.height=45;const motionContext=motion.getContext('2d',{willReadFrequently:true});
const gate=new RecognitionGate();let stream=null,worker=null,workerPromise=null,workerGeneration=0,loop=null,connecting=false,closed=false;
const STEP_ORDER=['read','interpret','done'];
function phase(name,hint,outcome=''){
 const steps=$('steps'),status=$('status-text'),result=$('outcome'),index=STEP_ORDER.indexOf(name),showSteps=index>=0;
 steps.hidden=!showSteps;status.hidden=showSteps;if(!showSteps)status.textContent='카메라 대기';
 [...steps.children].forEach((el,i)=>{el.classList.toggle('settled',name==='done'||i<index);el.classList.toggle('active',name!=='done'&&i===index);if(name!=='done'&&i===index)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
 $('notice').className='notice '+(name==='done'?(outcome?'done':'warn'):name==='paused'?'paused':'checking');
 result.hidden=!outcome;if(outcome)result.textContent=outcome;
 $('notice').setAttribute('aria-label',outcome||(name==='interpret'?'해석 중':name==='done'?'완료':name==='read'?'읽음':'카메라 대기'));
 if(hint)$('hint').textContent=hint;
}
function clearBoxes(){context.clearRect(0,0,overlay.width,overlay.height);}
function clearReadings(){const panel=$('readings');$('reading-list').replaceChildren();panel.hidden=true;}
function showReadings(books,flagged){
 const bad=new Set(flagged),list=$('reading-list');
 list.replaceChildren(...books.map((book,index)=>{
  const item=document.createElement('li');
  const indexMark=document.createElement('span');
  indexMark.className='reading-index';
  indexMark.textContent=String(index+1);
  const number=document.createElement('span');
  number.className='reading-number';
  const classification=document.createElement('span');
  classification.textContent=book.classification||'—';
  const author=document.createElement('span');
  author.textContent=book.author||'읽지 못함';
  number.append(classification,author);
  item.append(indexMark,number);
  if(bad.has(book))item.className='bad';
  return item;
 }));
 $('readings').hidden=!books.length;
}
function layout(){const stage=$('stage').getBoundingClientRect(),ratio=video.videoWidth/video.videoHeight;if(!Number.isFinite(ratio))return;let w=stage.width,h=w/ratio;if(h>stage.height){h=stage.height;w=h*ratio;}overlay.style.width=w+'px';overlay.style.height=h+'px';overlay.style.left=(stage.width-w)/2+'px';overlay.style.top=(stage.height-h)/2+'px';}
window.addEventListener('resize',layout);
function cameraError(error){
 $('error').hidden=false;clearBoxes();clearReadings();phase('paused','카메라가 연결되면 자동으로 확인합니다.');
 const messages={NotAllowedError:'주소창의 카메라 권한을 허용해 주세요. 앱 안의 브라우저에서 열리지 않으면 Safari 또는 Chrome에서 이 주소를 열어 주세요.',NotFoundError:'연결된 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰이나 PC에서 열어 주세요.',NotReadableError:'다른 앱이 카메라를 사용 중일 수 있습니다. 해당 앱을 닫고 다시 연결해 주세요.',SecurityError:'HTTPS 주소의 일반 브라우저에서 열고 카메라 권한을 허용해 주세요.'};
 $('error-title').textContent='카메라 연결이 필요합니다';$('error-detail').textContent=messages[error.name]||error.message||'카메라를 연결하지 못했습니다.';
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
function signature(){motionContext.drawImage(video,0,0,80,45);const pixels=motionContext.getImageData(0,0,80,45).data;const values=new Uint8Array(80*45);for(let i=0;i<values.length;i++)values[i]=Math.round((pixels[i*4]+pixels[i*4+1]+pixels[i*4+2])/3);return values;}
function drawBoxes(books,width,height){overlay.width=width;overlay.height=height;layout();context.strokeStyle='#ffe000';context.lineWidth=Math.max(4,width/240);context.shadowColor='#0008';context.shadowBlur=3;for(const book of books){const [x,y,r,b]=book.bbox;const inset=context.lineWidth/2;context.strokeRect(x+inset,y+inset,Math.max(1,r-x-inset*2),Math.max(1,b-y-inset*2));}}
async function recognize(){
 const token=gate.begin();nativeFrame.width=video.videoWidth;nativeFrame.height=video.videoHeight;nativeContext.drawImage(video,0,0);const scale=Math.min(1,2000/Math.max(video.videoWidth,video.videoHeight));snapshot.width=Math.round(video.videoWidth*scale);snapshot.height=Math.round(video.videoHeight*scale);snapshotContext.drawImage(video,0,0,snapshot.width,snapshot.height);
 // Capture before asynchronous model work. Movement invalidates this revision.
 const image=snapshotContext.getImageData(0,0,snapshot.width,snapshot.height),encoded=snapshot.toDataURL('image/png');
 if(token!==gate.revision||document.hidden){gate.finish(token,false,performance.now());return;}
 gate.freeze();
 phase('interpret',worker?'화면을 움직여도 됩니다.':'화면을 움직여도 됩니다. 처음에는 인식 준비에 시간이 걸릴 수 있습니다.');
 try{
  const engine=await getWorker();if(token!==gate.revision||document.hidden){gate.finish(token,false,performance.now());return;}
  const prepare=(book,part,variant)=>prepareLine(nativeFrame,book,part,image.width,undefined,variant);prepare.tiles=()=>detectionTiles(nativeFrame,image.width);prepare.shelf=()=>analyzeShelf(snapshot);
  const labels=await withTimeout(recognizeLabels(engine,encoded,image.width,image.height,()=>token===gate.revision&&!document.hidden,prepare));
  const books=refineBookEdges(labels,image),result=decreasingBooks(books);
  if(!gate.finish(token,result.complete,performance.now())||document.hidden)return;
  showReadings(books,result.flagged);
  if(result.complete&&result.flagged.length){drawBoxes(result.flagged,image.width,image.height);phase('done','노란 글자와 테두리: 순서가 잘못된 책');}
  else if(result.complete){clearBoxes();phase('done','다른 단을 보려면 화면을 움직여 주세요.','정상 배치');}
  else{clearBoxes();phase('read','흰색 청구기호 두 줄이 선명하게 보이도록 가까이 비춰 주세요.');}
 }catch(error){
  const fresh=gate.finish(token,false,performance.now());await resetWorker();
  if(fresh&&!document.hidden)phase('read',error.message||'선명한 책장 장면을 다시 확인합니다.');
 }
}
function tick(){
 if(!stream||document.hidden||connecting||video.readyState<2||closed)return;
 const update=gate.tick(signature(),performance.now());
 if(update.moved){clearBoxes();phase('read','청구기호가 보이도록 한 단을 가만히 비춰 주세요.');}
 if(update.ready)void recognize();
}
async function startCamera(){
 if(connecting||closed)return;connecting=true;$('retry').disabled=true;$('error').hidden=true;phase('read','카메라 사용을 허용해 주세요.');gate.reset();clearBoxes();clearReadings();
 if(loop){clearInterval(loop);loop=null;}stream?.getTracks().forEach(t=>t.stop());stream=null;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Object.assign(Error('HTTPS 주소의 Chrome 또는 Safari에서 열어 주세요.'),{name:'SecurityError'});
  const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}}});
  if(closed){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;await improveCameraFocus(stream.getVideoTracks()[0]);video.srcObject=stream;await video.play();layout();
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(!closed){gate.reset();cameraError({name:'NotReadableError'});}});
  phase('read','청구기호가 보이도록 한 단을 가만히 비춰 주세요.');loop=setInterval(tick,180);
 }catch(error){cameraError(error);}finally{connecting=false;$('retry').disabled=false;}
}
$('retry').onclick=startCamera;
video.addEventListener('loadedmetadata',layout);
video.addEventListener('resize',()=>{gate.reset();clearBoxes();clearReadings();layout();});
video.addEventListener('pause',()=>{if(stream&&!document.hidden&&!connecting)phase('read','카메라 화면을 다시 연결하고 있습니다.');});
window.addEventListener('pagehide',()=>{closed=true;clearInterval(loop);stream?.getTracks().forEach(t=>t.stop());void resetWorker();});
window.addEventListener('pageshow',e=>{if(e.persisted){closed=false;void startCamera();}});
 document.addEventListener('visibilitychange',()=>{gate.reset();clearBoxes();clearReadings();stream?.getTracks().forEach(t=>{t.enabled=!document.hidden;});if(document.hidden){video.pause();phase('read','화면으로 돌아오면 자동으로 확인합니다.');}else if(stream){video.play().catch(cameraError);phase('read','청구기호가 보이도록 한 단을 가만히 비춰 주세요.');}});
void startCamera();
