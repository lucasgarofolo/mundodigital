const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp'),{randomUUID}=require('node:crypto');
const {createApplication}=require('./helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
const renderer=require('./helpers/storyRenderer');
const image=()=>sharp({create:{width:512,height:512,channels:3,background:'#b5c8cc'}}).png().toBuffer();
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Condition did not settle');}
async function start(options={}){
 await fs.mkdir('.test-data',{recursive:true});const dataDir=options.dataDir||await fs.mkdtemp(path.resolve('.test-data/selfie-privacy-'));
 const logs=[],r=await createApplication({dataDir,avatarProvider:'openrouter',avatarTimeoutMs:0,entryDelayMs:0,entrySpacingMs:0,
  analyzeSelfie:async filename=>{assert.ok((await fs.readFile(filename)).length);return DEFAULT_AVATAR;},
  generatePortrait:async filename=>{assert.ok((await fs.readFile(filename)).length);return image();},storyRenderer:renderer,
  portraitRetryDelayMs:20,logger:(event,details)=>logs.push({event,details}),...options});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 return {...r,dataDir,logs,base:`http://localhost:${r.server.address().port}`};
}
async function register(r,ack){
 if(arguments.length<2)ack='true';
 const form=new FormData();form.set('name','Visitante Privado');form.set('email',`${randomUUID()}@example.test`);
 if(ack!==undefined)form.set('selfieAiAcknowledged',ack);
 form.set('selfie',new Blob([await image()],{type:'image/png'}),'private.png');
 const response=await fetch(r.base+'/api/check-in',{method:'POST',body:form});return {response,...await response.json()};
}
const auth=s=>({Authorization:'Bearer '+s.reviewToken});
async function settled(r){await r.avatarPipeline.idle();await r.passService.idle();await r.selfieLifecycle.idle();}
const exists=filename=>fs.stat(filename).then(()=>true).catch(()=>false);
const photoPath=(r,id)=>path.join(r.dataDir,'photos',`${id}.png`);

test('backend requires explicit acknowledgement before persisting any selfie or scheduling providers',async()=>{
 let calls=0;const r=await start({analyzeSelfie:async()=>{calls++;return DEFAULT_AVATAR;},generatePortrait:async()=>{calls++;return image();}});
 try{
  for(const value of [undefined,'false','yes','1','']){const s=await register(r,value);assert.equal(s.response.status,400);assert.match(s.error,/Confirme/);}
  assert.equal(calls,0);assert.equal(r.store.list().length,0);assert.deepEqual(await fs.readdir(path.join(r.dataDir,'photos')),[]);
 }finally{await r.close();}
});

test('normal completion deletes the private image/reference, records notice/version, and preserves LPC/portrait/pass/Story through refresh',async()=>{
 const r=await start();try{
  const s=await register(r),id=s.participant.uuid;assert.equal(s.response.status,201);await settled(r);
  let p=r.store.findByUuid(id);assert.equal(p.avatarStatus,'READY');assert.equal(p.portraitStatus,'READY');
  assert.equal(p.photoPath,null);assert.equal(p.selfieStatus,'DELETED');assert.ok(Date.parse(p.selfieDeletedAt));assert.ok(Date.parse(p.selfieAiAcknowledgedAt));assert.equal(p.selfieNoticeVersion,'1.0');
  assert.equal(await exists(photoPath(r,id)),false);assert.equal((await fetch(r.base+`/photos/${id}.png`)).status,404);
  const simulation=r.store.db.prepare('SELECT simulation FROM participants WHERE uuid=?').get(id).simulation;assert.ok(!simulation.includes('photoPath'));
  assert.equal((await fetch(r.base+p.avatar)).status,200);assert.ok(await exists(r.passService.paths(id).portrait));
  assert.equal((await fetch(r.base+'/pass/'+id)).status,200);
  assert.equal((await fetch(r.base+`/api/participants/${id}/approve-avatar`,{method:'POST',headers:auth(s)})).status,200);
  await r.passService.idle();p=r.store.findByUuid(id);assert.equal(p.storyStatus,'READY');
  const pass=await(await fetch(r.base+'/api/pass/'+id)).json();assert.equal((await fetch(r.base+pass.pass.storyUrl)).status,200);
  const status=await(await fetch(r.base+`/api/participants/${id}/avatar-status`,{headers:auth(s)})).json();assert.equal(status.participant.selfieStatus,'DELETED');
  assert.equal((await fetch(r.base+'/tela')).status,200);assert.equal((await fetch(r.base+'/check-in')).status,200);
  const reprocess=await fetch(r.base+`/api/participants/${id}/retry-portrait`,{method:'POST',headers:auth(s)});
  assert.equal(reprocess.status,409);assert.match((await reprocess.json()).error,/Selfie original removida por privacidade/);
 }finally{await r.close();}
});

test('OpenRouter finishing first cannot delete while Cloudflare is processing',async()=>{
 const hold=gate(),began=gate(),r=await start({generatePortrait:async filename=>{began.resolve();await hold.promise;assert.ok(await exists(filename));return image();}});
 try{const s=await register(r),id=s.participant.uuid;await began.promise;await r.avatarPipeline.idle();await r.selfieLifecycle.sweep();
  assert.equal(r.store.findByUuid(id).avatarStatus,'READY');assert.equal(r.store.findByUuid(id).portraitStatus,'PROCESSING');assert.ok(await exists(photoPath(r,id)));
  hold.resolve();await settled(r);assert.equal(r.store.findByUuid(id).selfieStatus,'DELETED');
 }finally{hold.resolve();await r.close();}
});

test('Cloudflare finishing first cannot delete while OpenRouter is processing',async()=>{
 const hold=gate(),r=await start({analyzeSelfie:async filename=>{await hold.promise;assert.ok(await exists(filename));return DEFAULT_AVATAR;}});
 try{const s=await register(r),id=s.participant.uuid;await r.passService.idle();await r.selfieLifecycle.sweep();
  assert.equal(r.store.findByUuid(id).portraitStatus,'READY');assert.equal(r.store.findByUuid(id).avatarStatus,'PENDING');assert.ok(await exists(photoPath(r,id)));
  hold.resolve();await settled(r);assert.equal(r.store.findByUuid(id).photoPath,null);
 }finally{hold.resolve();await r.close();}
});

test('OpenRouter automatic retry keeps the selfie until its second attempt actually settles',async()=>{
 const hold=gate(),second=gate();let calls=0;
 const r=await start({analyzeSelfie:async filename=>{calls++;assert.ok(await exists(filename));if(calls===1)throw Object.assign(Error('transient'),{status:503});second.resolve();await hold.promise;return DEFAULT_AVATAR;}});
 try{const s=await register(r),id=s.participant.uuid;await second.promise;await r.selfieLifecycle.sweep();
  assert.equal(calls,2);assert.equal(r.store.findByUuid(id).avatarAttempts,2);assert.ok(await exists(photoPath(r,id)));
  hold.resolve();await settled(r);assert.equal(r.store.findByUuid(id).selfieStatus,'DELETED');
 }finally{hold.resolve();await r.close();}
});

test('OpenRouter permanent/exhausted failures retain fallback LPC and portrait, then delete the selfie without cross-provider retries',async()=>{
 for(const status of [401,503]){
  let calls=0;const r=await start({analyzeSelfie:async()=>{calls++;throw Object.assign(Error('PRIVATE REQUEST CONTENT'),{status});}});
  try{const s=await register(r),id=s.participant.uuid;await settled(r);const p=r.store.findByUuid(id);
   assert.equal(calls,status===503?2:1);assert.equal(p.avatarStatus,'FALLBACK');assert.equal(p.portraitStatus,'READY');assert.equal(p.selfieStatus,'DELETED');
   assert.equal((await fetch(r.base+p.avatar)).status,200);assert.ok(await exists(r.passService.paths(id).portrait));assert.ok(!JSON.stringify(r.logs).includes('PRIVATE REQUEST'));
  }finally{await r.close();}
 }
});

test('Cloudflare retries retain the selfie; exhausted failures delete it while preserving the LPC and fallback pass',async()=>{
 const hold=gate(),second=gate();let calls=0;
 const r=await start({generatePortrait:async filename=>{calls++;assert.ok(await exists(filename));if(calls===2){second.resolve();await hold.promise;}throw Object.assign(Error('temporary'),{status:503});}});
 try{const s=await register(r),id=s.participant.uuid;await second.promise;await r.avatarPipeline.idle();await r.selfieLifecycle.sweep();
  assert.equal(r.store.findByUuid(id).avatarStatus,'READY');assert.ok(await exists(photoPath(r,id)));hold.resolve();await settled(r);
  const p=r.store.findByUuid(id);assert.equal(calls,2);assert.equal(p.portraitStatus,'FAILED');assert.equal(p.portraitAttempts,2);assert.equal(p.selfieStatus,'DELETED');
  assert.equal((await fetch(r.base+'/pass/'+id)).status,200);assert.equal((await fetch(r.base+p.avatar)).status,200);
 }finally{hold.resolve();await r.close();}
});

test('owner retry within the existing budget still works while the other consumer keeps the selfie available',async()=>{
 const hold=gate();let calls=0;const r=await start({analyzeSelfie:async()=>{await hold.promise;return DEFAULT_AVATAR;},
  generatePortrait:async()=>{if(++calls===1)throw Object.assign(Error('permanent'),{status:401});return image();}});
 try{const s=await register(r),id=s.participant.uuid;await r.passService.idle();assert.ok(await exists(photoPath(r,id)));
  const retry=await fetch(r.base+`/api/participants/${id}/retry-portrait`,{method:'POST',headers:auth(s)});assert.equal(retry.status,200);
  await r.passService.idle();assert.equal(calls,2);assert.equal(r.store.findByUuid(id).portraitStatus,'READY');assert.ok(await exists(photoPath(r,id)));
  hold.resolve();await settled(r);assert.equal(r.store.findByUuid(id).selfieStatus,'DELETED');
 }finally{hold.resolve();await r.close();}
});

test('timeout fallback does not delete underneath an analyzer promise that has not acknowledged cancellation',async()=>{
 const hold=gate(),began=gate(),r=await start({avatarTimeoutMs:25,analyzeSelfie:async()=>{began.resolve();await hold.promise;return DEFAULT_AVATAR;}});
 try{const s=await register(r),id=s.participant.uuid;await began.promise;await settled(r);await r.selfieLifecycle.sweep();
  assert.equal(r.store.findByUuid(id).avatarStatus,'FALLBACK');assert.ok(r.selfieLifecycle.activeLeases>0);assert.ok(await exists(photoPath(r,id)));
  hold.resolve();await until(()=>r.store.findByUuid(id).selfieStatus==='DELETED');assert.equal(r.selfieLifecycle.activeLeases,0);
  assert.equal((await fetch(r.base+'/health')).status,200);
 }finally{hold.resolve();await r.close();}
});

test('DELETE_FAILED preserves the reference and retries automatically; logs never contain image content or filesystem messages',async()=>{
 let fail=true,calls=0;const r=await start({selfieCleanupOptions:{intervalMs:20,unlink:async filename=>{calls++;if(fail)throw Object.assign(Error('PRIVATE PATH TOKEN BASE64'),{code:'EPERM'});return fs.unlink(filename);}}});
 try{const s=await register(r),id=s.participant.uuid;await settled(r);let p=r.store.findByUuid(id);
  assert.equal(p.selfieStatus,'DELETE_FAILED');assert.ok(p.photoPath);assert.equal(p.selfieDeletedAt,null);assert.ok(await exists(photoPath(r,id)));
  fail=false;await until(()=>r.store.findByUuid(id).selfieStatus==='DELETED');p=r.store.findByUuid(id);assert.equal(p.photoPath,null);assert.ok(calls>=2);
  assert.ok(!JSON.stringify(r.logs).includes('PRIVATE PATH'));assert.ok(!JSON.stringify(r.logs).includes('photos/'));assert.ok(!JSON.stringify(r.logs).includes('data:image'));
 }finally{fail=false;await r.close();}
});

test('restart recovers completed pipelines with an undeleted selfie, preserves generated assets and does not call providers again',async()=>{
 let r=await start({selfieCleanupOptions:{unlink:async()=>{throw Object.assign(Error('locked'),{code:'EBUSY'});}}});
 const s=await register(r),id=s.participant.uuid;await settled(r);const before=r.store.findByUuid(id),dataDir=r.dataDir;
 assert.equal(before.selfieStatus,'DELETE_FAILED');assert.ok(await exists(photoPath(r,id)));await r.close();let calls=0;
 r=await start({dataDir,analyzeSelfie:async()=>{calls++;throw Error('must not analyze');},generatePortrait:async()=>{calls++;throw Error('must not generate');}});
 try{await settled(r);const p=r.store.findByUuid(id);assert.equal(calls,0);assert.equal(p.photoPath,null);assert.equal(p.selfieStatus,'DELETED');
  assert.equal(p.avatar,before.avatar);assert.ok(await exists(r.passService.paths(id).portrait));assert.equal((await fetch(r.base+'/pass/'+id)).status,200);
 }finally{await r.close();}
});

test('restart handles a crash after unlink but before reference cleanup by accepting ENOENT',async()=>{
 let r=await start({selfieCleanupOptions:{unlink:async filename=>{await fs.unlink(filename).catch(()=>{});throw Object.assign(Error('after unlink'),{code:'EIO'});}}});
 const s=await register(r),id=s.participant.uuid;await settled(r);const dataDir=r.dataDir;assert.equal(await exists(photoPath(r,id)),false);await r.close();
 r=await start({dataDir});try{assert.equal(r.store.findByUuid(id).selfieStatus,'DELETED');assert.equal(r.store.findByUuid(id).photoPath,null);}finally{await r.close();}
});

test('safety sweep never expires an active old selfie and removes only old unreferenced canonical files once jobs finish',async()=>{
 const hold=gate(),r=await start({analyzeSelfie:async()=>{await hold.promise;return DEFAULT_AVATAR;}});
 try{const s=await register(r),id=s.participant.uuid,old=path.join(r.dataDir,'photos',`${randomUUID()}.png`),fresh=path.join(r.dataDir,'photos',`${randomUUID()}.png`);
  await fs.writeFile(old,await image());await fs.writeFile(fresh,await image());const time=new Date(Date.now()-172800000);
  await fs.utimes(old,time,time);await fs.utimes(photoPath(r,id),time,time);await r.selfieLifecycle.sweep();
  assert.ok(await exists(old));assert.ok(await exists(photoPath(r,id)));hold.resolve();await settled(r);await r.selfieLifecycle.sweep();
  assert.equal(await exists(old),false);assert.equal(await exists(photoPath(r,id)),false);assert.equal(await exists(fresh),true);
 }finally{hold.resolve();await r.close();}
});

test('local avatar variation after deletion does not require or recreate the selfie and does not call the analyzer again',async()=>{
 let calls=0;const r=await start({analyzeSelfie:async()=>{calls++;return DEFAULT_AVATAR;}});
 try{const s=await register(r),id=s.participant.uuid;await settled(r);assert.equal(r.store.findByUuid(id).photoPath,null);
  const response=await fetch(r.base+`/api/participants/${id}/regenerate-avatar`,{method:'POST',headers:auth(s)});assert.equal(response.status,200);
  await settled(r);assert.equal(calls,1);assert.equal(r.store.findByUuid(id).avatarStatus,'READY');assert.equal(r.store.findByUuid(id).photoPath,null);
  assert.deepEqual(await fs.readdir(path.join(r.dataDir,'photos')),[]);
 }finally{await r.close();}
});
