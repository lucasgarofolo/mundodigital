const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),sharp=require('sharp');
const {createApplication,sessionFor}=require('./helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
const {createOperationEvents}=require('../lib/operationEvents');
const {io}=require('socket.io-client');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await tick(100);}throw Error('Condition timed out');}
async function start(options={}){await fs.mkdir('.test-data',{recursive:true});const dataDir=options.dataDir||await fs.mkdtemp(path.resolve('.test-data/admin-operations-'));
 const r=await createApplication({dataDir,avatarProvider:'local',logger:()=>{},generatePortrait:async()=>image(),entryDelayMs:0,entrySpacingMs:0,storyRenderer:require('./helpers/storyRenderer'),...options});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,dataDir,base:`http://localhost:${r.server.address().port}`};}
const image=()=>sharp({create:{width:512,height:512,channels:3,background:'#b8cbc1'}}).png().toBuffer();
async function seed(r,name,options={}){const {createWalker}=await import('../public/js/movement.js');const uuid=randomUUID();
 const w=createWalker({id:uuid,name,avatar:`/avatars/${uuid}.png`,avatarKind:'lpc',avatarType:'lpc',avatarStatus:options.avatarStatus||'READY',appearance:DEFAULT_AVATAR,
  experienceStatus:options.experienceStatus||'ACTIVE',currentBlock:'blockB_upper',currentArea:'area_access'},0);
 r.store.insert(w,uuid+'@example.test',Date.now());r.store.requestPortrait(uuid);r.store.finishPortrait(uuid,{ready:true,generatedAt:new Date().toISOString()});
 r.store.db.prepare('UPDATE participants SET portrait_status=?,story_status=?,status=?,avatar_attempts=?,portrait_attempts=?,selfie_status=?,scheduled_entry_at=? WHERE uuid=?')
  .run(options.portraitStatus||'READY',options.storyStatus||'READY',options.status||'CHECKED_IN',options.avatarAttempts||0,options.portraitAttempts||0,options.selfieStatus||'DELETED',options.scheduledEntryAt||null,uuid);
 if(options.assets){await fs.writeFile(path.join(r.dataDir,'avatars',uuid+'.png'),await fs.readFile('public/assets/avatars/lpc/test-avatar.png'));const p=r.passService.paths(uuid);await fs.mkdir(p.directory,{recursive:true});await fs.writeFile(p.portrait,await image());}
 if(['ACTIVE','ENTERING'].includes(w.experienceStatus)&&options.status!=='INACTIVE')r.walkers.set(uuid,w);
 return r.store.findByUuid(uuid);}
const summary=async r=>(await(await fetch(r.base+'/api/admin/operations')).json());
const detail=async(r,id)=>(await(await fetch(`${r.base}/api/admin/participants/${id}`)).json()).participant;
const action=(r,id,name,body={})=>fetch(`${r.base}/api/admin/participants/${id}/actions/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
async function checkin(r){const form=new FormData();form.set('name','Visitante Operação');form.set('email',randomUUID()+'@example.test');form.set('selfieAiAcknowledged','true');form.set('selfie',new Blob([await image()],{type:'image/png'}),'synthetic.png');const response=await fetch(r.base+'/api/check-in',{method:'POST',body:form});assert.equal(response.status,201);return (await response.json()).participant;}

test('backend aggregates actual states, paginates/filter/searches by accent-insensitive name or UUID, and never projects private image/session fields',async()=>{
 const r=await start({analyzeSelfie:async()=>DEFAULT_AVATAR});try{
  await seed(r,'Ativo');await seed(r,'João Credencial',{experienceStatus:'AVATAR_REVIEW'});await seed(r,'Agendado',{experienceStatus:'AVATAR_APPROVED',scheduledEntryAt:new Date(Date.now()+60000).toISOString()});
  await seed(r,'Entrando',{experienceStatus:'ENTERING'});await seed(r,'Processando',{experienceStatus:'AVATAR_PROCESSING',avatarStatus:'PENDING',portraitStatus:'PROCESSING'});
  await seed(r,'João Credencial',{experienceStatus:'AVATAR_REVIEW',avatarStatus:'FALLBACK'});await seed(r,'Falha portrait',{portraitStatus:'FAILED'});await seed(r,'Inativo',{status:'INACTIVE',portraitStatus:'FAILED'});
  r.store.list=()=>{throw Error('Dashboard must not load all participants');};
  const data=await summary(r);assert.deepEqual(data.counters,{total:8,active:2,passReady:2,entryScheduled:1,entering:1,processing:1,failed:2,selfieDeleteFailed:0});
  const query=async parameters=>(await(await fetch(r.base+'/api/admin/participants?'+parameters)).json());
  const joao=await query('q=JOAO');assert.equal(joao.total,2);assert.notEqual(joao.participants[0].uuid,joao.participants[1].uuid);
  assert.equal((await query('filter=FAILED')).total,2);assert.equal((await query('filter=ACTIVE')).total,2);assert.equal((await query('filter=PASS_READY')).total,2);
  assert.equal((await query('q='+joao.participants[0].uuid.slice(0,8))).total,1);
  for(let i=0;i<30;i++)await seed(r,'Página '+i,{experienceStatus:'AVATAR_REVIEW'});
  assert.equal((await query('page=1')).participants.length,25);assert.equal((await query('page=2')).participants.length,13);
  assert.equal((await fetch(r.base+'/api/admin/participants?filter=unknown')).status,400);assert.equal((await fetch(r.base+'/api/admin/participants?limit=1000')).status,400);
  const serialized=JSON.stringify({data,list:await query(''),detail:await detail(r,joao.participants[0].uuid)});
  for(const forbidden of ['photoPath','photos/','reviewToken','password_hash','data:image','appearance_json','@example.test'])assert.ok(!serialized.includes(forbidden),forbidden);
  for(const route of ['/api/admin/operations','/api/admin/participants',`/api/admin/participants/${joao.participants[0].uuid}`])assert.equal((await r.publicFetch(r.base+route)).status,401);
  assert.equal((await r.publicFetch(r.base+'/api/admin/camera/home',{method:'POST'})).status,401);
  const auth=await sessionFor(r.base);assert.equal((await r.publicFetch(r.base+'/api/admin/camera/home',{method:'POST',headers:{Cookie:auth.cookie,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})})).status,403);
  assert.equal((await action(r,'invalid','remove')).status,400);
  assert.equal((await action(r,joao.participants[0].uuid,'toString')).status,400);
  assert.equal((await action(r,joao.participants[0].uuid,'home')).status,400);
 }finally{await r.close();}
});

test('force/cancel use the real entry scheduler, are state-checked/idempotent, and Story regeneration is deduplicated and independent of selfies/AI',async()=>{
 let lpc=0,portraits=0,renders=0;const r=await start({entryDelayMs:800,analyzeSelfie:async()=>{lpc++;return DEFAULT_AVATAR;},generatePortrait:async()=>{portraits++;return image();},storyRenderer:{render:async(_data,{outputPath})=>{renders++;await tick(60);await fs.writeFile(outputPath,await image());},close:async()=>{}}});
 try{
  const p=await seed(r,'Credencial',{experienceStatus:'AVATAR_REVIEW',assets:true}),requestId=randomUUID();assert.equal((await detail(r,p.uuid)).actions.forceEntry.allowed,true);
  const results=await Promise.all([action(r,p.uuid,'force-entry',{requestId}),action(r,p.uuid,'force-entry',{requestId})]);assert.ok(results.every(response=>response.status===200));assert.equal(r.entryScheduler.size,1);
  assert.equal((await action(r,p.uuid,'force-entry')).status,409);
  assert.equal((await action(r,p.uuid,'cancel-entry')).status,400);assert.equal((await action(r,p.uuid,'cancel-entry',{confirm:true})).status,200);assert.equal(r.entryScheduler.size,0);
  await tick(900);assert.equal(r.walkers.has(p.uuid),false);assert.equal(r.store.findByUuid(p.uuid).experienceStatus,'AVATAR_REVIEW');
  assert.equal((await action(r,p.uuid,'force-entry')).status,200);await until(()=>r.walkers.has(p.uuid));assert.equal(r.walkers.size,1);
  await r.passService.idle();const before=renders,storyKey=randomUUID();const stories=await Promise.all([action(r,p.uuid,'regenerate-story',{requestId:storyKey}),action(r,p.uuid,'regenerate-story',{requestId:storyKey})]);assert.ok(stories.every(response=>response.status===200));
  await r.passService.idle();assert.equal(renders,before+1);assert.equal(lpc,0);assert.equal(portraits,0);assert.equal(r.store.findByUuid(p.uuid).storyStatus,'READY');
  const d=await detail(r,p.uuid);assert.equal(d.selfieStatus,'DELETED');assert.equal(d.actions.retryLpc.allowed,false);assert.equal(d.actions.retryPortrait.allowed,false);
  assert.equal((await action(r,p.uuid,'retry-lpc')).status,409);assert.equal((await action(r,p.uuid,'retry-portrait')).status,409);
 }finally{await r.close();}
});

test('DELETE_FAILED retry uses only cleanup, removes the real temporary file once, and counters/events update without IA',async()=>{
 let unlinks=0,fail=true,analysis=0,portraits=0;
 const r=await start({analyzeSelfie:async()=>{analysis++;return DEFAULT_AVATAR;},generatePortrait:async()=>{portraits++;return image();},selfieCleanupOptions:{unlink:async filename=>{unlinks++;if(fail)throw Object.assign(Error('PRIVATE_PATH'),{code:'EACCES'});return fs.unlink(filename);}}});
 try{const p=await checkin(r);await r.avatarPipeline.idle();await r.passService.idle();await r.selfieLifecycle.idle();let d=await detail(r,p.uuid);assert.equal(d.selfieStatus,'DELETE_FAILED');assert.equal(d.actions.retryDelete.allowed,true);
  const counts=[analysis,portraits],previous=unlinks;fail=false;const requestId=randomUUID();const responses=await Promise.all([action(r,p.uuid,'retry-selfie-delete',{requestId}),action(r,p.uuid,'retry-selfie-delete',{requestId})]);assert.ok(responses.every(response=>response.status===200));assert.equal(unlinks,previous+1);
  assert.deepEqual([analysis,portraits],counts);d=await detail(r,p.uuid);assert.equal(d.selfieStatus,'DELETED');assert.equal(r.store.findByUuid(p.uuid).photoPath,null);assert.equal((await summary(r)).counters.selfieDeleteFailed,0);
  assert.ok((await summary(r)).activity.some(e=>e.event==='selfie:deleted'));
 }finally{await r.close();}
});

test('removal releases slots/social state and tracking, preserves participant/pass/assets, and cannot re-enter after refresh',async()=>{
 const r=await start();try{
  const p=await seed(r,'Remover',{assets:true}),w=r.walkers.get(p.uuid);w.allowExploration=true;r.visitController.register(w);r.visitController.select(w);
  r.operatorControl.focus(p.uuid);assert.equal((await action(r,p.uuid,'remove')).status,400);
  assert.equal((await action(r,p.uuid,'remove',{confirm:true})).status,200);
  assert.equal(r.walkers.has(p.uuid),false);assert.equal(r.visitController.info(w).targetPoi,null);assert.equal(w.socialInteraction,null);assert.equal(r.operatorControl.state().cameraMode,'HOME');
  const stored=r.store.findByUuid(p.uuid);assert.ok(stored);assert.equal(stored.status,'INACTIVE');assert.equal(stored.avatar,p.avatar);assert.equal(stored.passNumber,p.passNumber);
  assert.equal((await fetch(r.base+'/pass/'+p.uuid)).status,200);assert.equal((await fetch(r.base+p.avatar)).status,200);
  const d=await detail(r,p.uuid);assert.equal(d.status,'INACTIVE');assert.equal(d.actions.forceEntry.allowed,false);assert.equal((await summary(r)).counters.total,1);assert.equal((await summary(r)).counters.active,0);
  assert.equal((await action(r,p.uuid,'remove',{confirm:true})).status,409);
 }finally{await r.close();}
});

test('only live world sockets count as TV; admin receives bounded incremental signals and can reuse existing focus/HOME',async()=>{
 const r=await start(),sockets=[];const connect=async mode=>{const auth=await sessionFor(r.base),socket=io(r.base,{autoConnect:false,auth:{mode},extraHeaders:{Cookie:auth.cookie,Origin:r.base},transports:['websocket'],reconnection:false});sockets.push(socket);await new Promise((yes,no)=>{socket.once('connect',yes);socket.once('connect_error',no);socket.connect();});return socket;};
 try{const admin=await connect('admin');await connect('operator');assert.equal((await summary(r)).system.tv.status,'OFFLINE');
  const signals=[];admin.on('admin:updated',event=>signals.push(event));const tv=await connect('live');assert.equal((await summary(r)).system.tv.status,'ONLINE');
  const p=await seed(r,'Localizar');assert.equal((await action(r,p.uuid,'locate')).status,200);assert.equal(r.operatorControl.state().focusedParticipantUuid,p.uuid);
  const home=await fetch(r.base+'/api/admin/camera/home',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})});assert.equal(home.status,200);assert.equal(r.operatorControl.state().cameraMode,'HOME');
  tv.close();await until(async()=>(await summary(r)).system.tv.status==='OFFLINE');await until(()=>signals.length>0);assert.ok(signals.every(event=>!event.participants&&event.participantUuids.length<=50));
 }finally{for(const socket of sockets)socket.close();await r.close();}
});

test('OpenRouter 429 and Cloudflare timeout are observed independently; reads never trigger paid checks and logs expose only safe metadata',async t=>{
 const previous=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-private-key';t.after(()=>{if(previous===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous;});
 const native=globalThis.fetch;let rejectLpc=true,calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url)==='https://openrouter.ai/api/v1/chat/completions'){calls++;return rejectLpc?Response.json({error:{code:429,message:'PRIVATE BASE64 KEY'}},{status:429}):Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(DEFAULT_AVATAR)}}],usage:{cost:0.0001}});}return native(url,options);});
 for(const failLpc of [true,false]){rejectLpc=failLpc;let portraitCalls=0;const r=await start({avatarProvider:'openrouter',portraitRetryDelayMs:1,generatePortrait:async()=>{portraitCalls++;if(!failLpc)throw Object.assign(Error('PRIVATE TIMEOUT'),{code:'PORTRAIT_REQUEST_FAILED'});return image();}});
  try{const p=await checkin(r);await r.avatarPipeline.idle();await r.passService.idle();const data=await summary(r),d=await detail(r,p.uuid);
   assert.equal(d.avatarStatus,failLpc?'FALLBACK':'READY');assert.equal(d.portraitStatus,failLpc?'READY':'FAILED');
   if(failLpc){assert.equal(data.system.openrouter.status,'WARNING');assert.equal(data.system.openrouter.lastError.status,429);assert.equal(data.system.openrouter.lastError.code,'OPENROUTER_QUOTA');}
   else{assert.equal(data.system.openrouter.status,'OK');assert.equal(data.system.openrouter.lastCost,0.0001);assert.equal(data.system.cloudflare.status,'WARNING');assert.equal(data.system.cloudflare.lastError.code,'PORTRAIT_REQUEST_FAILED');}
   const before=[calls,portraitCalls];await summary(r);await summary(r);assert.deepEqual([calls,portraitCalls],before);
   const json=JSON.stringify({data,d});for(const secret of ['PRIVATE','synthetic-private-key','photoPath','reviewToken','photos/','data:image'])assert.ok(!json.includes(secret));
  }finally{await r.close();}
 }
});

test('activity is bounded/ephemeral, code fields are allowlisted, and ambiguous UUID prefixes never identify another participant',()=>{
 const events=createOperationEvents({resolve:ref=>ref.length===36?{uuid:ref,name:'Pessoa'}:null});
 for(let i=0;i<75;i++)events.record('portrait:failed',{ref:'12345678',code:'PRIVATE_SECRET',raw:'PRIVATE_BASE64'});
 assert.equal(events.activity().length,50);assert.ok(events.activity().every(e=>e.name===null&&e.uuid===null));assert.ok(!JSON.stringify(events.activity()).includes('PRIVATE'));
 const id=randomUUID();events.record('admin:action',{participantUuid:id,username:'admin-test',action:'REMOVE_FROM_WORLD'});assert.equal(events.activity()[0].uuid,id);
 assert.equal(createOperationEvents().activity().length,0);
});

test('available selfies can recover LPC within its original budget while portrait owns a lease; concurrent retries never duplicate calls',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const r=await start({analyzeSelfie:async()=>{calls++;if(calls===1)throw Object.assign(Error('Synthetic quota'),{code:'OPENROUTER_QUOTA',status:429});return DEFAULT_AVATAR;},generatePortrait:async()=>{await gate;return image();}});
 try{const p=await checkin(r);await r.avatarPipeline.idle();let d=await detail(r,p.uuid);assert.equal(d.actions.retryLpc.allowed,true);assert.equal(d.actions.retryPortrait.allowed,false);
  const key=randomUUID(),results=await Promise.all([action(r,p.uuid,'retry-lpc',{requestId:key}),action(r,p.uuid,'retry-lpc',{requestId:key})]);assert.ok(results.every(response=>response.status===200));await r.avatarPipeline.idle();assert.equal(calls,2);
  assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'READY');assert.ok(r.store.findByUuid(p.uuid).photoPath);release();await r.passService.idle();await r.selfieLifecycle.idle();assert.equal(r.store.findByUuid(p.uuid).selfieStatus,'DELETED');
 }finally{release();await r.close();}
});

test('removal during an existing portrait job leaves its input leased until completion and still cleans the selfie afterward',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const r=await start({passConfig:{portraitWaitMs:0},generatePortrait:async filename=>{await gate;assert.ok((await fs.stat(filename)).size>0);return image();}});
 try{const p=await checkin(r);const record=r.store.findByUuid(p.uuid);assert.equal((await fetch(`${r.base}/api/participants/${p.uuid}/approve-avatar`,{method:'POST',headers:{Authorization:'Bearer '+record.reviewToken}})).status,200);
  await until(()=>r.walkers.has(p.uuid));assert.equal((await action(r,p.uuid,'remove',{confirm:true})).status,200);
  assert.ok(r.store.findByUuid(p.uuid).photoPath);assert.ok(r.selfieLifecycle.activeLeases>0);release();await r.passService.idle();await r.selfieLifecycle.idle();
  const removed=r.store.findByUuid(p.uuid);assert.equal(removed.status,'INACTIVE');assert.equal(removed.portraitStatus,'READY');assert.equal(removed.selfieStatus,'DELETED');assert.equal(removed.photoPath,null);assert.equal(r.walkers.size,0);
 }finally{release();await r.close();}
});

test('restart settles an interrupted portrait of an inactive participant without IA and recovers selfie cleanup',async()=>{
 let calls=0,r=await start({generatePortrait:async()=>{calls++;return image();}});const dataDir=r.dataDir;
 try{const p=await seed(r,'Removido antes do restart',{status:'INACTIVE',portraitStatus:'PROCESSING',selfieStatus:'PROCESSING',assets:true});
  await fs.writeFile(path.join(dataDir,'photos',p.uuid+'.png'),await image());
  r.store.db.prepare("UPDATE participants SET photo_path=?,avatar_selfie_finished_at=?,portrait_selfie_finished_at=NULL,portrait_attempts=1 WHERE uuid=?")
   .run('photos/'+p.uuid+'.png',new Date().toISOString(),p.uuid);
  await r.close();r=await start({dataDir,generatePortrait:async()=>{calls++;return image();}});await r.passService.idle();await r.selfieLifecycle.idle();
  const restored=r.store.findByUuid(p.uuid);assert.equal(calls,0);assert.equal(restored.status,'INACTIVE');assert.equal(restored.selfieStatus,'DELETED');assert.equal(restored.photoPath,null);assert.equal(r.walkers.size,0);
  assert.equal((await fetch(r.base+'/pass/'+p.uuid)).status,200);assert.equal((await fetch(r.base+p.avatar)).status,200);
 }finally{await r.close();}
});

test('a stuck terminal selfie is only warned about by read endpoints; no read starts cleanup or a new job',async()=>{
 let deletes=0;const r=await start({selfieCleanupOptions:{unlink:async()=>{deletes++;}}});
 try{const p=await seed(r,'Cleanup aguardando',{selfieStatus:'AVAILABLE'});await fs.writeFile(path.join(r.dataDir,'photos',p.uuid+'.png'),await image());
  const old=new Date(Date.now()-180000).toISOString();r.store.db.prepare('UPDATE participants SET photo_path=?,avatar_selfie_finished_at=?,portrait_selfie_finished_at=? WHERE uuid=?').run('photos/'+p.uuid+'.png',old,old,p.uuid);
  const data=await detail(r,p.uuid);assert.equal(data.cleanupWaiting,true);assert.equal(data.actions.retryDelete.allowed,false);await summary(r);assert.equal(deletes,0);assert.equal(r.avatarPipeline.stats.running,0);assert.equal(r.passService.selfieJobs,0);
 }finally{await r.close();}
});

test('available selfie portrait recovery reuses the existing queue/budget while LPC still holds its input lease',async()=>{
 let release,calls=0;const wait=new Promise(resolve=>{release=resolve;});const r=await start({analyzeSelfie:async()=>{await wait;return DEFAULT_AVATAR;},
  generatePortrait:async()=>{calls++;if(calls===1)throw Object.assign(Error('Synthetic non-transient failure'),{code:'PORTRAIT_HTTP_ERROR',status:400});return image();}});
 try{const p=await checkin(r);await r.passService.idle();const d=await detail(r,p.uuid);assert.equal(d.actions.retryPortrait.allowed,true);assert.equal(d.actions.retryLpc.allowed,false);
  const requestId=randomUUID(),responses=await Promise.all([action(r,p.uuid,'retry-portrait',{requestId}),action(r,p.uuid,'retry-portrait',{requestId})]);assert.ok(responses.every(response=>response.status===200));await r.passService.idle();assert.equal(calls,2);assert.equal(r.store.findByUuid(p.uuid).portraitStatus,'READY');assert.ok(r.store.findByUuid(p.uuid).photoPath);
  release();await r.avatarPipeline.idle();await r.selfieLifecycle.idle();assert.equal(r.store.findByUuid(p.uuid).selfieStatus,'DELETED');
 }finally{release();await r.close();}
});
