const fs=require('node:fs/promises'),path=require('node:path');
const sharp=require('sharp');
const {setTimeout:sleep}=require('node:timers/promises');
const {createPortraitProvider}=require('./portraitProvider');
const {createStoryRenderer,storyFailure}=require('./storyRenderer');
const {passConfig,passData,storyHash}=require('./passView');
const {selfieRemovedError}=require('./selfieLifecycle');
function createPassService({store,dataDir,generatePortrait,renderer=createStoryRenderer(),config=passConfig(),logger=()=>{},retryDelayMs=1000,selfieLifecycle}){
 generatePortrait??=createPortraitProvider({logger});
 const root=path.join(dataDir,'generated/participants'),controllers=new Set(),participantControllers=new Map();let stopped=false,resetting=false;
 const queues={portrait:[],story:[]},known={portrait:new Set(),story:new Set()},running=new Set(),busy={portrait:false,story:false};
 const paths=uuid=>({directory:path.join(root,uuid),portrait:path.join(root,uuid,'portrait.png'),story:path.join(root,uuid,'story.png')});
 const data=p=>passData(p,config);
 const safeError=error=>({code:new Set(['PORTRAIT_NOT_CONFIGURED','PORTRAIT_MODEL_INVALID','PORTRAIT_HTTP_ERROR','PORTRAIT_INVALID_RESPONSE','PORTRAIT_REQUEST_FAILED','PORTRAIT_TIMEOUT','PORTRAIT_NETWORK_ERROR','PORTRAIT_QUOTA','PORTRAIT_INVALID_IMAGE','PORTRAIT_ABORTED','PHOTO_MISSING']).has(error.code)?error.code:'GENERATION_ERROR',...(Number.isInteger(error.status)?{status:error.status}:{})});
 function enqueue(type,uuid){if(stopped||resetting||known[type].has(uuid))return;known[type].add(uuid);queues[type].push(uuid);pump(type);}
 async function portrait(uuid,signal){
  let p=store.findByUuid(uuid);if(!p?.portraitRequestedAt)return;
  // A restart may recover an interrupted portrait after its avatar was removed.
  // There is no new AI job for inactive participants; settle the old consumer for cleanup.
  if(p.status==='INACTIVE'){if(['PENDING','PROCESSING'].includes(p.portraitStatus))store.finishPortrait(uuid);return;}
  const files=paths(uuid);await fs.mkdir(files.directory,{recursive:true});
  // Recover a PNG written before a crash between atomic rename and the SQLite update.
  if(p.portraitStatus!=='READY'&&p.portraitAttempts>0){
   const valid=await sharp(files.portrait).metadata().then(m=>m.width===512&&m.height===512).catch(()=>false);
   if(valid){store.finishPortrait(uuid,{ready:true,generatedAt:new Date().toISOString()});enqueue('story',uuid);return;}
  }
  if(p.portraitStatus==='READY'){enqueue('story',uuid);return;}
  if(p.selfieStatus==='DELETED'){
   store.finishPortrait(uuid);logger('portrait:failed',{ref:uuid.slice(0,8),code:'SELFIE_REMOVED'});return;
  }
  while(!signal.aborted&&store.startPortrait(uuid)){
   const started=performance.now();
   logger('portrait:processing-started',{ref:uuid.slice(0,8),managedProvider:!!generatePortrait.managesProviderEvents});
   try{
    if(!/^photos\/[0-9a-f-]{36}\.png$/i.test(p.photoPath||''))throw Object.assign(new Error('PHOTO_MISSING'),{code:'PHOTO_MISSING'});
    const result=await generatePortrait(path.join(dataDir,p.photoPath),{signal});
    if(signal.aborted)return;
    const png=await sharp(result,{limitInputPixels:20000000}).resize(512,512,{fit:'cover'}).png().toBuffer();
    if(signal.aborted)return;
    await fs.writeFile(files.portrait+'.tmp',png);await fs.rename(files.portrait+'.tmp',files.portrait);
    if(signal.aborted)return;
    store.finishPortrait(uuid,{ready:true,generatedAt:new Date().toISOString()});logger('portrait:ready',{ref:uuid.slice(0,8),managedProvider:!!generatePortrait.managesProviderEvents,duration_ms:Math.round(performance.now()-started)});
    enqueue('story',uuid);return;
   }catch(error){
    if(signal.aborted)return;
    store.finishPortrait(uuid);logger('portrait:failed',{ref:uuid.slice(0,8),managedProvider:!!generatePortrait.managesProviderEvents,provider:error.provider,...safeError(error),duration_ms:Math.round(performance.now()-started)});
    const transient=[429,500,502,503,504].includes(error.status)||error.code==='PORTRAIT_REQUEST_FAILED';
    if(error.retryable!==false&&transient&&store.retryPortrait(uuid)){await sleep(retryDelayMs,undefined,{signal});p=store.findByUuid(uuid);continue;}
    enqueue('story',uuid);return;
   }
  }
 }
 async function story(uuid,signal){
  const p=store.findByUuid(uuid);if(!p?.passNumber||!['AVATAR_APPROVED','ENTERING','ACTIVE'].includes(p.experienceStatus)||!['READY','FALLBACK'].includes(p.avatarStatus))return;
  const snapshot=data(p),hash=storyHash(snapshot),files=paths(uuid);
  if(p.storyStatus==='READY'&&p.storyHash===hash&&await fs.stat(files.story).then(()=>true).catch(()=>false))return;
  const avatarMatch=/^\/avatars\/([0-9a-f-]{36}(?:-[0-9a-f]{16})?\.png)$/.exec(p.avatar);
  const started=performance.now();let stage='asset_read';
  try{
   if(!avatarMatch)throw Object.assign(new Error('STORY_ASSET_MISSING'),{code:'STORY_ASSET_MISSING'});
   store.updateStory(uuid,'PROCESSING');stage='asset_write';await fs.mkdir(files.directory,{recursive:true});stage='html_render';
   await renderer.render(snapshot,{portraitPath:p.portraitStatus==='READY'?files.portrait:null,avatarPath:path.join(dataDir,'avatars',avatarMatch[1]),
    cssPath:path.join(__dirname,'../public/css/pass.css'),outputPath:files.story+'.tmp',signal});
   if(signal.aborted)return;
   stage='asset_write';await fs.rename(files.story+'.tmp',files.story);store.updateStory(uuid,'READY',hash);logger('story:generated',{ref:uuid.slice(0,8),duration_ms:Math.round(performance.now()-started)});
  }catch(error){if(!signal.aborted){const failure=storyFailure(error,stage);store.updateStory(uuid,'FAILED');logger('story:generation-failed',{ref:uuid.slice(0,8),code:failure.code,stage:failure.stage,duration_ms:Math.round(performance.now()-started)});}}
 }
 function pump(type){
  if(stopped||resetting||busy[type]||!queues[type].length)return;
  const uuid=queues[type].shift(),controller=new AbortController();controllers.add(controller);participantControllers.set(type+':'+uuid,controller);busy[type]=true;
 const run=async()=>{
   let release;
   try{
    const p=store.findByUuid(uuid);
    if(type==='portrait'&&p?.portraitStatus!=='READY'&&p?.photoPath)release=selfieLifecycle?.acquire(uuid);
    await (type==='portrait'?portrait:story)(uuid,controller.signal);
   }finally{release?.();}
  };
  const task=run().catch(()=>{if(!controller.signal.aborted)logger(`${type}:job-failed`,{ref:uuid.slice(0,8)});})
   .finally(()=>{busy[type]=false;controllers.delete(controller);participantControllers.delete(type+':'+uuid);known[type].delete(uuid);running.delete(task);
    if(type==='portrait'&&!stopped&&!resetting&&['READY','FAILED'].includes(store.findByUuid(uuid)?.portraitStatus))selfieLifecycle?.finish(uuid,'portrait');
    selfieLifecycle?.request(uuid).catch(()=>{});
    // Profile/config changes during an export require one export of the new snapshot.
    if(type==='story'&&!stopped&&!resetting){const p=store.findByUuid(uuid);if(p?.storyStatus==='READY'&&p.storyHash!==storyHash(data(p)))enqueue('story',uuid);}
    pump(type);});
  running.add(task);
 }
 store.recoverPortraits();
 for(const p of store.list())if(p.portraitRequestedAt){if(p.portraitStatus!=='READY')enqueue('portrait',p.uuid);else enqueue('story',p.uuid);}
 return {config,data,paths,
  request(uuid){if(stopped||resetting)return; if(store.requestPortrait(uuid))enqueue('portrait',uuid);},
  entryApproved(uuid){enqueue('story',uuid);},
  retry(uuid){
   const p=store.findByUuid(uuid);if(p?.selfieStatus==='DELETED'||p?.selfieDeletedAt||p?.photoPath&&selfieLifecycle&&!selfieLifecycle.canUse(uuid))throw selfieRemovedError();
   if(stopped||resetting||known.portrait.has(uuid)||!store.retryPortrait(uuid))return false;enqueue('portrait',uuid);return true;
  },
  hasSelfieWork(uuid){return known.portrait.has(uuid);},
  hasStoryWork(uuid){return known.story.has(uuid);},
  cancel(uuid){for(const type of ['portrait','story']){
   const index=queues[type].indexOf(uuid);if(index>=0){queues[type].splice(index,1);known[type].delete(uuid);}
   participantControllers.get(type+':'+uuid)?.abort();
  }},
  get stats(){return Object.fromEntries(Object.keys(queues).map(type=>[type,{queued:queues[type].length,running:busy[type]?1:0}]));},
  get selfieJobs(){return known.portrait.size;},
  regenerateStory(uuid){if(stopped||resetting||known.story.has(uuid))return false;
   const p=store.findByUuid(uuid);if(!p?.passNumber||!data(p).shareAllowed||!['READY','FALLBACK'].includes(p.avatarStatus))return false;
   store.updateStory(uuid,'PENDING');enqueue('story',uuid);return true;},
  settleInactive(uuid){const index=queues.portrait.indexOf(uuid);if(index>=0){queues.portrait.splice(index,1);known.portrait.delete(uuid);}
   selfieLifecycle?.request(uuid).catch(()=>{});},
  refreshStory(uuid){enqueue('story',uuid);},
  async idle(){while(running.size||queues.portrait.length||queues.story.length)await Promise.allSettled([...running]);},
  async reset(){resetting=true;queues.portrait.length=0;queues.story.length=0;for(const c of controllers)c.abort();await Promise.allSettled([...running]);known.portrait.clear();known.story.clear();await renderer.close?.();resetting=false;},
  async close(){stopped=true;await this.reset();}
 };
}
module.exports={createPassService};
