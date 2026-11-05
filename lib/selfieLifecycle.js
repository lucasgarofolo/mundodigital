const fs=require('node:fs/promises'),path=require('node:path');
const SELFIE_NOTICE_VERSION='1.0';
const SELFIE_REMOVED_MESSAGE='Selfie original removida por privacidade. Uma nova foto é necessária para este reprocessamento.';
const selfieRemovedError=()=>Object.assign(new Error(SELFIE_REMOVED_MESSAGE),{code:'SELFIE_REMOVED',status:409});

function createSelfieLifecycle({store,dataDir,walkers,isBusy=()=>false,canSweepOrphans=()=>false,logger=()=>{},now=Date.now,
 unlink=filename=>fs.unlink(filename),intervalMs=60000,orphanAgeMs=86400000}){
 const leases=new Map(),deleting=new Map();let timer,closed=false,sweeping;
 const terminal=p=>p&&p.photoPath&&
  (p.avatarStatus==='READY'||p.avatarSelfieFinishedAt&&['FALLBACK','FAILED'].includes(p.avatarStatus)||['FALLBACK','FAILED'].includes(p.avatarStatus)&&p.avatarAttempts>=2)&&
  (p.portraitStatus==='READY'||p.portraitSelfieFinishedAt&&p.portraitStatus==='FAILED'||p.portraitStatus==='FAILED'&&p.portraitAttempts>=2);
 const available=p=>!!p?.photoPath&&p.selfieStatus!=='DELETED'&&!deleting.has(p.uuid);
 const canUse=uuid=>available(store.findByUuid(uuid));
 function request(uuid){
  if(closed)return Promise.resolve(false);if(deleting.has(uuid))return deleting.get(uuid);
  let p;try{p=store.findByUuid(uuid);}catch{logger('selfie:cleanup-failed',{ref:uuid.slice(0,8),code:'SELFIE_STATE_ERROR'});return Promise.resolve(false);}
  if(!terminal(p)||leases.has(uuid)||isBusy(uuid))return Promise.resolve(false);
  const task=(async()=>{
   const relative=`photos/${p.uuid}.png`;
   try{
    if(p.photoPath.toLowerCase()!==relative.toLowerCase()||!/^photos\/[0-9a-f-]{36}\.png$/i.test(p.photoPath))
     throw Object.assign(new Error('Unsafe private image reference'),{code:'UNSAFE_SELFIE_PATH'});
    logger('selfie:cleanup-started',{ref:uuid.slice(0,8)});
    try{await unlink(path.join(dataDir,p.photoPath));}catch(error){if(error.code!=='ENOENT')throw error;}
    store.markSelfieDeleted(uuid,now());
    const w=walkers?.get(uuid);if(w){w.photoPath=null;w.selfieStatus='DELETED';w.selfieDeletedAt=new Date(now()).toISOString();}
    logger('selfie:deleted',{ref:uuid.slice(0,8)});return true;
   }catch(error){
    try{store.setSelfieStatus(uuid,'DELETE_FAILED');}catch{}
    const code=new Set(['EACCES','EPERM','EBUSY','EIO','UNSAFE_SELFIE_PATH']).has(error.code)?error.code:'SELFIE_DELETE_ERROR';
    logger('selfie:deletion-failed',{ref:uuid.slice(0,8),code});return false;
   }
  })().finally(()=>deleting.delete(uuid));
  deleting.set(uuid,task);return task;
 }
 return {canUse,request,
  inspect(uuid,p=store.findByUuid(uuid)){return {terminal:!!terminal(p),busy:leases.has(uuid)||isBusy(uuid),deleting:deleting.has(uuid),available:available(p)};},
  acquire(uuid){
   if(!canUse(uuid))throw selfieRemovedError();
   store.setSelfieStatus(uuid,'PROCESSING');leases.set(uuid,(leases.get(uuid)||0)+1);let released=false;
   return ()=>{if(released)return;released=true;const count=(leases.get(uuid)||1)-1;
    if(count)leases.set(uuid,count);else leases.delete(uuid);request(uuid).catch(()=>{});};
  },
  finish(uuid,consumer){try{store.finishSelfieConsumer(uuid,consumer,now());request(uuid).catch(()=>{});}
   catch{logger('selfie:cleanup-failed',{ref:uuid.slice(0,8),code:'SELFIE_STATE_ERROR'});}},
  sweep(){
   if(sweeping)return sweeping;
   sweeping=(async()=>{
   if(closed)return;
   await Promise.allSettled(store.list().filter(p=>p.photoPath).map(p=>request(p.uuid)));
   // Age alone is insufficient. Never sweep unknown files while any upload/job may use them.
   if(closed||leases.size||!canSweepOrphans())return;
   const directory=path.join(dataDir,'photos'),entries=await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]);
   for(const entry of entries){
    if(!entry.isFile()||!/^([0-9a-f-]{36})\.png$/i.test(entry.name))continue;
    const uuid=entry.name.slice(0,-4),filename=path.join(directory,entry.name);
    if(store.findByUuid(uuid)||leases.has(uuid)||isBusy(uuid))continue;
    const stat=await fs.lstat(filename).catch(()=>null);
    if(!stat?.isFile()||now()-stat.mtimeMs<orphanAgeMs||!canSweepOrphans()||leases.size||store.findByUuid(uuid))continue;
    try{await unlink(filename);logger('selfie:orphan-deleted',{ref:uuid.slice(0,8)});}
    catch{logger('selfie:deletion-failed',{ref:uuid.slice(0,8),code:'ORPHAN_DELETE_FAILED'});}
   }
   })().finally(()=>{sweeping=null;});return sweeping;
  },
  start(){if(!timer&&!closed){timer=setInterval(()=>this.sweep().catch(()=>logger('selfie:cleanup-failed',{code:'SELFIE_SWEEP_ERROR'})),intervalMs);timer.unref();}},
  async idle(){await Promise.allSettled([...deleting.values()]);},
  async close(){closed=true;clearInterval(timer);await Promise.allSettled([this.idle(),sweeping]);},
  get activeLeases(){return [...leases.values()].reduce((a,b)=>a+b,0);}
 };
}
module.exports={createSelfieLifecycle,SELFIE_NOTICE_VERSION,SELFIE_REMOVED_MESSAGE,selfieRemovedError};
