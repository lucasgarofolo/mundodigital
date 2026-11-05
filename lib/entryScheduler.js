function createEntryScheduler({store,walkers,createWalker,onEnter,now=Date.now,spacingMs=1000,logger=()=>{}}){
 const timers=new Map();let closed=false;
 function schedule(participant,extraDelay=0){
  const uuid=participant.uuid;
  if(closed||timers.has(uuid)||participant.experienceStatus!=='AVATAR_APPROVED')return;
  const delay=Math.max(0,Date.parse(participant.scheduledEntryAt)-now(),extraDelay);
  const timer=setTimeout(()=>{
   timers.delete(uuid);if(closed)return;
   try{
    const current=store.findByUuid(uuid);
    if(!current||current.status==='INACTIVE'||current.experienceStatus!=='AVATAR_APPROVED')return;
    const walker=createWalker(current,walkers.size,{enter:true});walker.experienceStatus='ENTERING';
    if(!store.beginEntry(walker,now()))return;
    walkers.set(uuid,walker);onEnter(walker);logger('participant:entry-started',{ref:uuid.slice(0,8)});
   }catch{logger('participant:entry-error',{ref:uuid.slice(0,8)});
    const current=store.findByUuid(uuid);if(current?.experienceStatus==='AVATAR_APPROVED')schedule(current,1000);
   }
  },delay);timer.unref();timers.set(uuid,timer);logger('participant:entry-scheduled',{ref:uuid.slice(0,8)});
 }
 function clear(){for(const timer of timers.values())clearTimeout(timer);timers.clear();}
 const approved=store.listRegistered().filter(p=>p.experienceStatus==='AVATAR_APPROVED')
  .sort((a,b)=>Date.parse(a.scheduledEntryAt)-Date.parse(b.scheduledEntryAt));
 let overdue=0;for(const p of approved)schedule(p,Date.parse(p.scheduledEntryAt)<=now()?overdue++*spacingMs:0);
 return {schedule,clear,cancel(uuid){const timer=timers.get(uuid);if(timer)clearTimeout(timer);return timers.delete(uuid);},close(){closed=true;clear();},get size(){return timers.size;}};
}
module.exports={createEntryScheduler};
