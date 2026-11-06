const path=require('node:path');
const {setTimeout:sleep}=require('node:timers/promises');
const {DEFAULT_AVATAR,validateAppearance}=require('./avatarCatalog');
const {buildLpcAvatar}=require('./lpcAvatarBuilder');
const {avatarVariation}=require('./avatarVariation');
const {geminiConfig}=require('./geminiAvatarAnalyzer');
const {selfieRemovedError}=require('./selfieLifecycle');

function createAvatarPipeline({store,dataDir,walkers,analyzeSelfie,build=buildLpcAvatar,onUpdated,logger=()=>{},now=Date.now,
 concurrency=2,timeoutMs=geminiConfig().timeoutMs,retryDelayMs=1000,timeoutCode='GEMINI_TIMEOUT',selfieLifecycle}){
 const queue=[],queuedAt=new Map(),known=new Set(),running=new Set(),controllers=new Set(),participantControllers=new Map();let stopping=false,resetting=false;
 async function processParticipant(uuid,queueWaitMs=0){
  const participant=store.findByUuid(uuid);
  if(!participant||participant.avatarStatus!=='PENDING'||participant.status!=='CHECKED_IN')return;
  const reference=uuid.slice(0,8),controller=new AbortController();controllers.add(controller);participantControllers.set(uuid,controller);
  let timeout,release;const started=performance.now();
  try{
   const localVariation=participant.avatarVersions>1&&participant.experienceStatus==='AVATAR_PROCESSING';
   if(!localVariation&&participant.selfieStatus==='DELETED')throw selfieRemovedError();
   if(!localVariation&&participant.photoPath)release=selfieLifecycle?.acquire(uuid);
   if(!localVariation&&!store.startAvatarAttempt(uuid))throw Object.assign(new Error('Attempt limit'),{code:'AVATAR_ATTEMPT_LIMIT'});
   logger(localVariation?'avatar:variation-started':'avatar:analysis-started',{ref:reference,queue_wait_ms:queueWaitMs});
   if(!localVariation&&(!participant.photoPath||!/^photos\/[0-9a-f-]{36}\.png$/i.test(participant.photoPath)))throw Object.assign(new Error('Missing photo'),{code:'PHOTO_MISSING'});
   const deadline=new Promise((_,reject)=>{
    if(timeoutMs>0)timeout=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Analysis timeout'),{code:timeoutCode}));},timeoutMs);
    controller.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Analysis aborted'),{code:stopping?'SHUTDOWN':timeoutCode})),{once:true});
   });
   const releaseAnalysis=!localVariation?selfieLifecycle?.acquire(uuid):null;
   const analysis=(localVariation?Promise.resolve(avatarVariation(participant.appearance)):Promise.resolve().then(async()=>{
    const imagePath=path.join(dataDir,participant.photoPath);
    try{return await analyzeSelfie(imagePath,{signal:controller.signal});}
    catch(error){
     // Only transient provider failures retry. The persisted budget also covers restarts.
     if(controller.signal.aborted||![500,502,503,504].includes(error.status)||participant.avatarAttempts>=1)throw error;
     logger('avatar:analysis-retrying',{ref:reference,status:error.status,delayMs:retryDelayMs});
     await sleep(retryDelayMs,undefined,{signal:controller.signal});
     if(controller.signal.aborted||!store.startAvatarAttempt(uuid))throw error;
     return analyzeSelfie(imagePath,{signal:controller.signal});
    }
   })).finally(()=>releaseAnalysis?.());
   const analyzed=await Promise.race([analysis,deadline]);
   clearTimeout(timeout);
   if(stopping||resetting)return;
   const {appearance}=validateAppearance(analyzed,{strict:true});
   logger(localVariation?'avatar:variation-completed':'avatar:analysis-completed',{ref:reference,duration_ms:Math.round(performance.now()-started)});
   const buildStarted=performance.now();
   const result=await build({participantUuid:uuid,appearance,avatarDir:path.join(dataDir,'avatars')});
   if(stopping||resetting)return;
   const updated=store.updateAvatar(uuid,{...result,avatarStatus:'READY',appearance},now());
   if(updated){sync(updated);logger('avatar:generation-completed',{ref:reference,build_ms:Math.round(performance.now()-buildStarted),duration_ms:Math.round(performance.now()-started)});}
  }catch(error){
   if(stopping||resetting||store.findByUuid(uuid)?.status==='INACTIVE')return; // Interrupted work must not update a removed participant.
    const safeCodes=new Set(['GEMINI_NOT_CONFIGURED','GEMINI_TIMEOUT','GEMINI_API_ERROR','GEMINI_UNAVAILABLE','GEMINI_QUOTA','OLLAMA_TIMEOUT','OLLAMA_API_ERROR','OLLAMA_UNAVAILABLE',
     'OPENROUTER_NOT_CONFIGURED','OPENROUTER_TIMEOUT','OPENROUTER_AUTH_ERROR','OPENROUTER_QUOTA','OPENROUTER_UNAVAILABLE','OPENROUTER_API_ERROR','OPENROUTER_INVALID_RESPONSE','OPENROUTER_REFUSED','OPENROUTER_TRUNCATED',
     'INVALID_JSON','INVALID_APPEARANCE','PHOTO_MISSING','SELFIE_REMOVED','AVATAR_ATTEMPT_LIMIT']);
   const code=safeCodes.has(error.code)?error.code:'AVATAR_PROCESSING_ERROR';
   const updated=store.updateAvatar(uuid,{avatarStatus:'FALLBACK',appearance:participant.appearance||DEFAULT_AVATAR},now());
   if(updated)sync(updated);
   logger('avatar:fallback-used',{ref:reference,code,...(Number.isInteger(error.status)?{status:error.status}:{})});
  }finally{
   clearTimeout(timeout);controllers.delete(controller);participantControllers.delete(uuid);
   try{if(!stopping&&!resetting&&['READY','FALLBACK','FAILED'].includes(store.findByUuid(uuid)?.avatarStatus))selfieLifecycle?.finish(uuid,'avatar');}
   finally{release?.();}
  }
 }
 function sync(updated){
  const walker=walkers?.get(updated.uuid);
  if(walker)Object.assign(walker,{avatar:updated.avatar,avatarKind:updated.avatarKind,avatarType:updated.avatarType,
   avatarStatus:updated.avatarStatus,avatarVersion:updated.avatarVersion});
  onUpdated?.({uuid:updated.uuid,avatarUrl:updated.avatar,avatarKind:updated.avatarKind,
      avatarType:updated.avatarType,avatarStatus:updated.avatarStatus,avatarVersion:updated.avatarVersion});
 }
 function pump(){
  while(!stopping&&!resetting&&running.size<concurrency&&queue.length){
   const uuid=queue.shift();
   const queueWaitMs=Math.max(0,Math.round(performance.now()-(queuedAt.get(uuid)??performance.now())));queuedAt.delete(uuid);
   const task=processParticipant(uuid,queueWaitMs).catch(()=>logger('avatar:database-error',{ref:uuid.slice(0,8)}))
    .finally(()=>{known.delete(uuid);running.delete(task);selfieLifecycle?.request(uuid).catch(()=>{});pump();});
   running.add(task);
  }
 }
 return {
  enqueue(uuid){if(stopping||resetting||known.has(uuid))return;known.add(uuid);queuedAt.set(uuid,performance.now());queue.push(uuid);pump();},
  get stats(){return {queued:queue.length,running:running.size,concurrency};},
  has(uuid){return known.has(uuid);},
  cancel(uuid){const index=queue.indexOf(uuid);if(index>=0){queue.splice(index,1);queuedAt.delete(uuid);known.delete(uuid);}participantControllers.get(uuid)?.abort();},
  async idle(){while(running.size||queue.length)await Promise.allSettled([...running]);},
  async reset(){resetting=true;queue.length=0;queuedAt.clear();for(const controller of controllers)controller.abort();
   try{await Promise.allSettled([...running]);}finally{known.clear();resetting=false;}
  },
  async close(){stopping=true;queue.length=0;queuedAt.clear();for(const controller of controllers)controller.abort();await Promise.allSettled([...running]);},
 };
}
module.exports={createAvatarPipeline};
