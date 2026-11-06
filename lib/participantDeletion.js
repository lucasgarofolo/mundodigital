const fs=require('node:fs/promises'),path=require('node:path');
const {setTimeout:sleep}=require('node:timers/promises');
const PRE_ENTRY=new Set(['REGISTERED','AVATAR_PROCESSING','AVATAR_REVIEW','AVATAR_APPROVED']);
const canDeleteBeforeEntry=p=>!!p&&!p.enteredAt&&PRE_ENTRY.has(p.experienceStatus);
const issue=message=>Object.assign(new Error(message),{status:409});

// Permanent deletion is separate from removing an avatar from the live world.
function createParticipantDeletion({store,dataDir,avatarPipeline,passService,selfieLifecycle,entryScheduler,walkers,
 now=Date.now,logger=()=>{},onChanged=()=>{},waitMs=10000}){
 const tasks=new Map(),root=path.resolve(dataDir);
 async function erase(uuid){
  const p=store.findByUuid(uuid);
  if(!canDeleteBeforeEntry(p)||walkers.has(uuid)||!store.retireBeforeEntry(uuid,now()))
   throw issue('Somente cadastros que ainda não iniciaram a entrada podem ser excluídos.');
  // Retire atomically before any await: approval and retries must not revive this record.
  entryScheduler.cancel(uuid);avatarPipeline.cancel(uuid);passService.cancel(uuid);onChanged(uuid);
  const deadline=performance.now()+waitMs;
  while(avatarPipeline.has(uuid)||passService.hasSelfieWork(uuid)||passService.hasStoryWork(uuid)||
   selfieLifecycle.inspect(uuid).busy||selfieLifecycle.inspect(uuid).deleting){
   if(performance.now()>=deadline)throw issue('O processamento está sendo encerrado. Aguarde alguns instantes e tente excluir o cadastro novamente.');
   await sleep(50);
  }
  // Raw AI work may outlive its timeout; its selfie lease must also have ended.
  const current=store.findByUuid(uuid);
  if(!canDeleteBeforeEntry(current)||walkers.has(uuid))throw issue('O estado do participante mudou. Atualize o painel.');
  if(current.photoPath&&!await selfieLifecycle.request(uuid))
   throw issue('Não foi possível remover a selfie temporária. Tente excluir o cadastro novamente.');
  async function remove(relative,recursive=false){
   const target=path.resolve(root,relative),within=path.relative(root,target);
   if(!within||within==='..'||within.startsWith('..'+path.sep)||path.isAbsolute(within))throw Error('UNSAFE_DELETE_PATH');
   // Do not follow a redirected storage parent outside DATA_DIR.
   let parent;try{parent=await fs.realpath(path.dirname(target));}catch(error){if(error.code==='ENOENT')return;throw error;}
   const realRoot=await fs.realpath(root),parentRelative=path.relative(realRoot,parent);
   if(parentRelative==='..'||parentRelative.startsWith('..'+path.sep)||path.isAbsolute(parentRelative))throw Error('UNSAFE_DELETE_PATH');
   await fs.rm(target,{force:true,recursive});
  }
  await remove(`photos/${uuid}.png`);
  for(const name of await fs.readdir(path.join(root,'avatars')))
   if(name===`${uuid}.png`||new RegExp(`^${uuid}-[0-9a-f]{16}\\.png$`,'i').test(name))await remove(path.join('avatars',name));
  await remove(path.join('generated','participants',uuid),true);
  if(!store.deleteBeforeEntry(uuid))throw issue('O estado do participante mudou. Atualize o painel.');
  onChanged(uuid);
 }
 return {
  isDeleting:uuid=>tasks.has(uuid),get size(){return tasks.size;},
  delete(uuid){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))return Promise.reject(issue('UUID inválido.'));
   if(tasks.has(uuid))return Promise.reject(issue('A exclusão deste cadastro já está em andamento.'));
   const task=erase(uuid).catch(error=>{logger('participant:deletion-failed',{ref:uuid.slice(0,8),code:error.status===409?'DELETE_PENDING':'PARTICIPANT_DELETE_FAILED'});throw error;})
    .finally(()=>{tasks.delete(uuid);onChanged(uuid);});
   tasks.set(uuid,task);return task;
  },
  async idle(){await Promise.allSettled([...tasks.values()]);}
 };
}
module.exports={createParticipantDeletion,canDeleteBeforeEntry};
