import { uniformIndex, normalizedBoxes, containRect, FaceTracker } from './logic.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), stage = $('stage'), tracker = new FaceTracker();
const palette = ['#d8f56c','#c8b7f4','#ffcc9b','#b8ddd0','#f2bacc','#e8df9c','#a9d2e9'];
let phase='off', mode='auto', stream=null, detector=null, detectorPromise=null;
let tracks=[], roster=[], winnerId=null, highlightedId=null, cameraEpoch=0, facing='user', mirrored=true;
let loopId=0, animationId=0, chooseResolve=null, lastVideoTime=-1, lastDetection=0, lastTimestamp=0, lastSignature='';
let sound=false, audioContext=null, manualCursor={x:.5,y:.5}, detectorFailed=false, detectorEpoch=0;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const visibleTracks=()=>tracks.filter(t=>t.visible&&(mode==='manual'||t.hits>=2));
const color=id=>palette[(id-1)%palette.length];
const label=id=>`Person ${id}`;
function message(text=''){$('message').textContent=text;$('message').hidden=!text;}
function status(text){$('selectionStatus').textContent=text;}
function timestamp(){return lastTimestamp=Math.max(performance.now(),lastTimestamp+1);}
function dimensions(){return containRect(stage.clientWidth,stage.clientHeight,video.videoWidth||1280,video.videoHeight||720);}

function render(){
  const visible=visibleTracks(), active=!!stream&&phase!=='starting';
  $('cameraStatus').textContent=active?'LIVE':phase==='starting'?'CONNECTING':'CAMERA OFF';
  $('cameraStatus').className='status-pill'+(active?' live':'');
  $('chooseButton').disabled=!active||phase==='selecting'||visible.length===0;
  $('chooseButton').querySelector('span').textContent=phase==='selecting'?'Choosing…':phase==='result'?'Choose again':'Choose someone';
  $('startCamera').disabled=phase==='starting';$('stopCamera').disabled=phase==='off';
  $('stopCamera').textContent=phase==='starting'?'Cancel':'Camera off';
  $('flipCamera').disabled=!active||phase==='selecting';
  $('manualMode').disabled=!active||phase==='selecting'||mode==='manual';
  $('manualTools').hidden=!active||mode!=='manual'||phase==='selecting';
  $('autoMode').disabled=!detector||detectorFailed;
  $('clearMarkers').disabled=phase==='selecting';
  $('nextRound').hidden=phase!=='result';
  $('personCount').textContent=visible.length;
  $('odds').textContent=phase==='selecting'?`${roster.length} people in this round`:visible.length?`${visible.length} ${visible.length===1?'person':'people'} · equal chance`:'Waiting for your people';
  $('stageLabel').hidden=!active||phase==='result';
  $('stageLabel').textContent=phase==='selecting'?'CHOOSING LIVE…':mode==='manual'?'LIVE · STAY INSIDE YOUR MARKER':'LIVE · KEEP EVERYONE IN FRAME';
  $('resultBadge').hidden=phase!=='result';
  if(phase==='result')$('resultBadge').querySelector('span').textContent=tracks.some(t=>t.id===winnerId&&t.visible)?`${label(winnerId)}, you’re the one!`:`${label(winnerId)} · out of view`;
  stage.classList.toggle('active',active);stage.classList.toggle('selecting',phase==='selecting');
  const editable=mode==='manual'&&phase==='live';stage.style.cursor=editable?'crosshair':'';stage.tabIndex=editable?0:-1;
  stage.setAttribute('aria-label',editable?'Live camera. Tap to mark people. Arrow keys move the marker; Enter adds a person.':'Live camera selection');
  $('faces').classList.toggle('manual',editable);
  $('peopleList').replaceChildren();
  if(!visible.length){const empty=document.createElement('span');empty.className='people-empty';empty.textContent=active?(mode==='manual'?'Tap each person in the live view.':'Looking for faces. Move closer and face the camera.'):'Your people will appear here once the camera is on.';$('peopleList').append(empty);}
  for(const t of visible){const chip=document.createElement('span');chip.className='person-chip'+(t.id===winnerId?' selected':'');chip.style.setProperty('--person-color',color(t.id));const dot=document.createElement('span');dot.className='dot';dot.textContent=t.id;const name=document.createElement('span');name.textContent=label(t.id)+(t.id===winnerId?' · winner':phase==='selecting'&&!roster.includes(t.id)?' · next round':'');chip.append(dot,name);$('peopleList').append(chip);}
  drawBoxes();
}
function drawBoxes(){
  const area=dimensions();$('faces').replaceChildren();
  for(const t of visibleTracks()){
    const editable=mode==='manual'&&phase==='live',box=document.createElement(editable?'button':'div');
    box.className='face-box'+(t.id===highlightedId?' spotlight':'')+(t.id===winnerId?' winner':'');
    box.style.setProperty('--person-color',color(t.id));
    Object.assign(box.style,{left:`${area.x+t.x*area.width}px`,top:`${area.y+t.y*area.height}px`,width:`${t.width*area.width}px`,height:`${t.height*area.height}px`,background:'transparent',padding:'0'});
    box.dataset.personId=t.id;
    const tag=document.createElement('span');tag.className='face-label';tag.textContent=t.id===winnerId?`★ ${label(t.id)}`:label(t.id);
    if(area.y+t.y*area.height<30)tag.style.top='0';box.append(tag);
    if(editable){box.type='button';box.setAttribute('aria-label',`Remove ${label(t.id)}`);box.addEventListener('click',event=>{event.stopPropagation();tracks=tracks.filter(p=>p.id!==t.id);render();});}
    $('faces').append(box);
  }
}
async function loadDetector(){
  if(detector&&!detectorFailed)return detector;
  if(detector&&detectorFailed){detector.close();detector=null;}
  if(!detectorPromise)detectorPromise=(async()=>{
    const generation=detectorEpoch;
    const {FaceDetector,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
    const fileset=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);
    const created=await FaceDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:new URL('./vendor/blaze_face_short_range.tflite',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.5,minSuppressionThreshold:.3});
    if(generation!==detectorEpoch){created.close();throw new Error('Face tracking was stopped.');}detector=created;
    detectorFailed=false;return detector;
  })().catch(error=>{detectorPromise=null;throw error;});
  return detectorPromise;
}
function detect(now){
  const result=detector.detectForVideo(video,timestamp());
  const boxes=normalizedBoxes(result.detections,video.videoWidth,video.videoHeight,mirrored);
  tracks=tracker.update(boxes,now);
}
function beginDetection(){
  cancelAnimationFrame(loopId);
  function tick(now){
    if(!stream||phase==='off')return;
    if(mode==='auto'&&detector&&!detectorFailed&&video.readyState>=2&&video.currentTime!==lastVideoTime&&now-lastDetection>90){
      lastVideoTime=video.currentTime;lastDetection=now;
      try{detect(now);}catch{
        detectorFailed=true;detectorPromise=null;if(phase==='selecting')cancelSelection('Face tracking stopped. Please try another round.');
        tracks=[];tracker.reset();message('Automatic tracking is unavailable. You can mark fixed spots on the live video instead.');render();
      }
      if(phase==='selecting'&&roster.some(id=>!tracks.some(t=>t.id===id)))cancelSelection('Someone left the frame or tracking became uncertain. Gather everyone, then choose again.');
      const signature=visibleTracks().map(t=>t.id).join(',')+'|'+phase;
      if(signature!==lastSignature){lastSignature=signature;render();}else drawBoxes();
      if(phase==='live'&&!detectorFailed)status(visibleTracks().length?'Everyone in? The highlight will jump between your faces.':'Get everyone in the frame to begin.');
      if(phase==='result'){
        const present=tracks.some(t=>t.id===winnerId&&t.visible);
        $('resultBadge').querySelector('span').textContent=present?`${label(winnerId)}, you’re the one!`:`${label(winnerId)} · out of view`;
        status(present?`${label(winnerId)} takes the spotlight — still live!`:'The selected person is out of view. Choose again for a new round.');
      }
    }
    loopId=requestAnimationFrame(tick);
  }
  loopId=requestAnimationFrame(tick);
}
function cancelSelection(reason=''){
  cancelAnimationFrame(animationId);highlightedId=null;roster=[];$('selectionProgress').hidden=true;
  if(phase==='selecting')phase='live';if(chooseResolve){chooseResolve({cancelled:true,reason});chooseResolve=null;}
  if(reason){message(reason);status('Ready when everyone is back in view.');}render();
}
function releaseStream(){const old=stream;stream=null;old?.getTracks().forEach(t=>t.stop());video.srcObject=null;}
function stopCamera(clear=true){
  cameraEpoch++;cancelSelection();cancelAnimationFrame(loopId);releaseStream();
  phase='off';mode='auto';tracks=[];tracker.reset();winnerId=null;highlightedId=null;lastSignature='';
  video.hidden=true;$('cameraEmpty').hidden=false;$('manualCursor')?.remove();
  $('startCamera').innerHTML='<svg><use href="#i-camera"/></svg>Enable camera';
  status('Your next lucky pick is a tap away.');if(clear)message();render();
}
async function startCamera(){
  stopCamera();const epoch=++cameraEpoch;phase='starting';$('startCamera').textContent='Waiting for camera…';render();
  if(!navigator.mediaDevices?.getUserMedia){stopCamera();message('Camera access needs HTTPS or localhost. Open this site in a full browser tab.');return;}
  try{
    const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}});
    if(epoch!==cameraEpoch){next.getTracks().forEach(t=>t.stop());return;}
    stream=next;video.srcObject=next;mirrored=(next.getVideoTracks()[0].getSettings().facingMode||facing)==='user';video.classList.toggle('mirrored',mirrored);
    await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Camera timeout')),15000))]);
    if(epoch!==cameraEpoch)return;
    if(!video.videoWidth)throw new Error('No camera frames received');
    next.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===next){stopCamera();message('The camera disconnected. Enable it again to continue.');}});
    phase='live';video.hidden=false;$('cameraEmpty').hidden=true;message('Getting live face tracking ready…');render();beginDetection();
    try{
      await Promise.race([loadDetector(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tracking timeout')),25000))]);
      if(epoch===cameraEpoch){message(mode==='manual'?'Manual spots stay fixed. Keep each person inside their marker.':'');render();}
    }catch{if(epoch===cameraEpoch){message('Automatic tracking couldn’t load. Mark fixed spots on the live video, or restart the camera to retry.');render();}}
  }catch(error){
    if(epoch!==cameraEpoch)return;stopCamera();
    const messages={NotAllowedError:'Camera access was blocked. Allow camera access in your browser, then try again. If this is an embedded preview, open the site in a full browser tab.',NotFoundError:'No camera was found. Connect a webcam or open Chooser on your phone.',NotReadableError:'The camera is busy. Close other apps using it, then try again.'};
    message(messages[error.name]||'Couldn’t start the camera. Check your camera and browser permissions, then try again.');
  }
}
function resetRound(){
  if(!stream||phase==='selecting')return;
  winnerId=null;highlightedId=null;roster=[];phase='live';message(mode==='manual'?'Manual spots stay fixed. Keep each person inside their marker.':'');status('Everyone in? Choose someone when you’re ready.');render();
}
function enterManual(){
  if(!stream||phase==='selecting')return;
  winnerId=null;phase='live';mode='manual';tracks=visibleTracks().map(t=>({...t,visible:true,hits:2}));
  message('Manual spots stay fixed while the video stays live. Keep each person inside their marker.');status('Tap each person to add a marker.');render();
}
function useAuto(){
  if(!detector||detectorFailed||phase==='selecting')return;
  mode='auto';phase='live';winnerId=null;tracks=[];tracker.reset();lastSignature='';message();render();
}
function addPerson(x,y){
  if(mode!=='manual'||phase!=='live')return;
  if(tracks.some(t=>x>=t.x&&x<=t.x+t.width&&y>=t.y&&y<=t.y+t.height))return;
  const width=.13,height=Math.min(.3,width*video.videoWidth/video.videoHeight*1.25);
  tracks.push({id:tracker.nextId++,x:Math.max(0,Math.min(1-width,x-width/2)),y:Math.max(0,Math.min(1-height,y-height/2)),width,height,visible:true,hits:2});render();
}
stage.addEventListener('click',event=>{
  if(mode!=='manual'||phase!=='live'||event.target.closest('.face-box'))return;
  const rect=stage.getBoundingClientRect(),a=dimensions(),x=(event.clientX-rect.left-a.x)/a.width,y=(event.clientY-rect.top-a.y)/a.height;
  if(x>=0&&x<=1&&y>=0&&y<=1)addPerson(x,y);
});
stage.addEventListener('keydown',event=>{
  if(mode!=='manual'||phase!=='live'||event.target!==stage)return;
  const moves={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]};
  if(moves[event.key]){event.preventDefault();manualCursor.x=Math.max(0,Math.min(1,manualCursor.x+moves[event.key][0]));manualCursor.y=Math.max(0,Math.min(1,manualCursor.y+moves[event.key][1]));showCursor();}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();addPerson(manualCursor.x,manualCursor.y);showCursor();}
});
function showCursor(){let cursor=$('manualCursor');if(!cursor){cursor=document.createElement('span');cursor.id='manualCursor';cursor.textContent='+';cursor.className='manual-cursor';stage.append(cursor);}const a=dimensions();cursor.style.left=`${a.x+manualCursor.x*a.width}px`;cursor.style.top=`${a.y+manualCursor.y*a.height}px`;}
stage.addEventListener('blur',()=>$('manualCursor')?.remove());
function tone(frequency=500,duration=.04){
  if(!sound||!audioContext)return;
  try{const o=audioContext.createOscillator(),g=audioContext.createGain();o.connect(g);g.connect(audioContext.destination);o.frequency.value=frequency;g.gain.setValueAtTime(.025,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.start();o.stop(audioContext.currentTime+duration);}catch{}
}
async function choose(){
  if(!stream||!['live','result'].includes(phase)||!visibleTracks().length)throw new Error('Enable your camera and include at least one person first.');
  if(mode==='auto'){
    if(!detector||detectorFailed)throw new Error('Wait for face tracking or mark people manually.');
    detect(performance.now());
  }
  roster=visibleTracks().map(t=>t.id);
  if(!roster.length){render();throw new Error('Keep everyone in view and try again.');}
  const selectedId=roster[uniformIndex(roster.length)];
  winnerId=null;highlightedId=null;phase='selecting';message();$('manualCursor')?.remove();
  $('selectionProgress').hidden=false;status('Watch the highlight. Who will it land on?');render();
  audioContext?.resume().catch(()=>{});
  const start=performance.now(),duration=reducedMotion?350:4300;let nextHop=0;
  return await new Promise(resolve=>{
    chooseResolve=resolve;
    function animate(now){
      if(phase!=='selecting')return;
      const progress=Math.min(1,(now-start)/duration);
      $('selectionProgress').style.setProperty('--progress',`${progress*100}%`);
      if(now>=nextHop&&!reducedMotion){
        const available=visibleTracks().filter(t=>roster.includes(t.id)&&t.id!==highlightedId);
        if(available.length){highlightedId=available[uniformIndex(available.length)].id;tone(440+(highlightedId%7)*45);drawBoxes();}
        nextHop=now+90+progress*progress*310;
      }
      if(progress<1){animationId=requestAnimationFrame(animate);return;}
      if(mode==='auto'){
        try{detect(performance.now());}catch{cancelSelection('Face tracking stopped. Please try another round.');return;}
        if(roster.some(id=>!tracks.some(t=>t.id===id&&t.visible&&t.hits>=2))){cancelSelection('Someone moved out of view. Keep everyone visible, then choose again.');return;}
      }
      phase='result';winnerId=selectedId;highlightedId=null;$('selectionProgress').hidden=true;
      status(`${label(winnerId)} takes the spotlight — still live!`);tone(660,.15);setTimeout(()=>{if(phase==='result')tone(880,.2);},140);render();
      chooseResolve=null;resolve({winner:label(winnerId),participants:roster.length,live:true});
    }
    animationId=requestAnimationFrame(animate);
  });
}
$('startCamera').addEventListener('click',startCamera);
$('stopCamera').addEventListener('click',()=>stopCamera());
$('flipCamera').addEventListener('click',()=>{facing=facing==='user'?'environment':'user';startCamera();});
$('manualMode').addEventListener('click',enterManual);$('autoMode').addEventListener('click',useAuto);
$('clearMarkers').addEventListener('click',()=>{if(phase!=='selecting'){tracks=[];winnerId=null;phase='live';render();}});
$('nextRound').addEventListener('click',resetRound);
$('chooseButton').addEventListener('click',()=>choose().catch(error=>message(error.message)));
$('soundButton').addEventListener('click',()=>{sound=!sound;if(sound){try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{sound=false;}}$('soundButton').setAttribute('aria-pressed',String(sound));$('soundButton').setAttribute('aria-label',sound?'Turn sound off':'Turn sound on');$('soundButton').querySelector('span').textContent=sound?'Sound on':'Sound off';tone();});
$('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
for(const id of ['closeHelp','gotIt'])$(id).addEventListener('click',()=>$('helpDialog').close());
new ResizeObserver(drawBoxes).observe(stage);
window.addEventListener('pagehide',()=>{stopCamera();detectorEpoch++;detector?.close();detector=null;detectorPromise=null;});
render();

const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController(),inputSchema={type:'object',properties:{},additionalProperties:false};
  const validate=input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object.');};
  const actions=[
    {name:'get_chooser_state',title:'Read live chooser state',description:'Read the live camera status, included people and selected winner. No images are returned.',annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){validate(input);return {phase,mode,participants:visibleTracks().map(t=>label(t.id)),winner:winnerId?label(winnerId):null,live:!!stream&&!video.hidden};}},
    {name:'choose_person_live',title:'Choose a person live',description:'Cycle the highlight over people in an already enabled live camera and choose one at random. The camera keeps running.',annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){validate(input);return choose();}},
    {name:'reset_live_selection',title:'Clear the selected person',description:'Clear the result while keeping the camera live. Cannot interrupt an active selection.',annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){validate(input);if(!stream||phase==='selecting')throw new Error('Enable the camera and wait for selection to finish.');resetRound();return {phase,live:true};}}
  ];
  for(const action of actions){try{Promise.resolve(modelContext.registerTool({...action,inputSchema},{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
