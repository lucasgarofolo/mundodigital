const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {fork}=require('node:child_process');
const {createApplication}=require('./helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
const {experienceConfig}=require('../lib/experienceConfig');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await wait(20);}throw Error('State timeout');}
async function runtime(options={}){
 await fs.mkdir('.test-data',{recursive:true});const dataDir=options.dataDir||await fs.mkdtemp(path.resolve('.test-data/experience-'));
 const r=await createApplication({dataDir,avatarProvider:'local',storyRenderer:require('./helpers/storyRenderer'),logger:()=>{},entryDelayMs:150,entrySpacingMs:50,...options});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,dataDir,base:`http://localhost:${r.server.address().port}`};
}
async function register(r,index=0){
 const body=new FormData();body.set('selfieAiAcknowledged','true');body.set('name','Lucas');body.set('email',`approval-${index}@example.test`);
 const photo=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
 body.set('selfie',new Blob([photo],{type:'image/png'}),'test.png');
 const response=await fetch(r.base+'/api/check-in',{method:'POST',body});assert.equal(response.status,201);return response.json();
}
const action=(r,s,name,token=s.reviewToken)=>fetch(r.base+'/api/participants/'+s.participant.uuid+'/'+name,{method:'POST',headers:{Authorization:'Bearer '+token}});
const world=async r=>(await (await fetch(r.base+'/api/world')).json()).participants;

test('processing/review/fallback remain invisible; protected idempotent approval schedules one entry and server marks ACTIVE',async()=>{
 assert.equal(experienceConfig({}).entryDelayMs,8000);assert.equal(experienceConfig({}).maxAvatarVersions,2);
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const r=await runtime({entryDelayMs:800,analyzeSelfie:async()=>{await gate;return DEFAULT_AVATAR;}});
 try{
  const s=await register(r);assert.equal(s.participant.status,'AVATAR_PROCESSING');assert.deepEqual(await world(r),[]);
  assert.equal((await action(r,s,'approve-avatar')).status,409);
  assert.equal((await action(r,s,'approve-avatar','wrong')).status,403);
  release();await wait(20);await r.avatarPipeline.idle();assert.equal(r.store.findByUuid(s.participant.uuid).experienceStatus,'AVATAR_REVIEW');assert.deepEqual(await world(r),[]);
  let events=0;const original=r.io.to.bind(r.io);r.io.to=(...args)=>{const room=original(...args),emit=room.emit.bind(room);room.emit=(event,...data)=>{if(event==='participant:enter')events++;return emit(event,...data);};return room;};
  const responses=await Promise.all([action(r,s,'approve-avatar'),action(r,s,'approve-avatar')]);
  const approved=await responses[0].json(),duplicate=await responses[1].json();assert.equal(approved.participant.scheduledEntryAt,duplicate.participant.scheduledEntryAt);
  assert.equal(r.entryScheduler.size,1);assert.deepEqual(await world(r),[]);
  await until(()=>r.walkers.has(s.participant.uuid));assert.equal(events,1);
  const p=r.walkers.get(s.participant.uuid);assert.equal(p.state,'ENTERING');assert.ok(p.y>9);
  assert.ok(p.route.some(n=>n.id==='door_threshold'));
  await until(()=>r.store.findByUuid(p.uuid).experienceStatus==='ACTIVE');assert.ok(r.store.findByUuid(p.uuid).enteredAt);
  assert.equal((await action(r,s,'approve-avatar')).status,200);assert.equal(events,1);assert.equal(r.entryScheduler.size,0);
  const json=JSON.stringify(await world(r));assert.ok(!json.includes(s.reviewToken));assert.ok(!json.includes('email'));
 }finally{release();await r.close();}
});

test('regeneration uses one local variation, retains review, limits total versions to two and never calls Gemini again',async()=>{
 let calls=0;const r=await runtime({analyzeSelfie:async()=>{calls++;return DEFAULT_AVATAR;}});
 try{
  const s=await register(r);await wait(20);await r.avatarPipeline.idle();const first=r.store.findByUuid(s.participant.uuid);
  assert.equal((await action(r,s,'regenerate-avatar')).status,200);
  assert.equal((await action(r,s,'approve-avatar')).status,409);
  await r.avatarPipeline.idle();const second=r.store.findByUuid(first.uuid);
  assert.equal(second.experienceStatus,'AVATAR_REVIEW');assert.equal(second.avatarVersions,2);assert.equal(calls,1);assert.notEqual(second.avatar,first.avatar);
  assert.equal((await action(r,s,'regenerate-avatar')).status,409);assert.deepEqual(await world(r),[]);
  await action(r,s,'approve-avatar');await until(()=>r.walkers.has(first.uuid));assert.equal(r.walkers.get(first.uuid).avatar,second.avatar);
 }finally{await r.close();}
});

test('failed analysis still requires approval; five equal names have independently spaced entries',async()=>{
 const r=await runtime({analyzeSelfie:async()=>{throw Error('offline');},entrySpacingMs:60});
 try{
  const sessions=await Promise.all(Array.from({length:5},(_,i)=>register(r,i)));await wait(20);await r.avatarPipeline.idle();
  assert.deepEqual(await world(r),[]);assert.equal(r.store.listRegistered().filter(p=>p.experienceStatus==='AVATAR_REVIEW'&&p.avatarStatus==='FALLBACK').length,5);
  const results=await Promise.all(sessions.map(s=>action(r,s,'approve-avatar').then(r=>r.json())));
  const dates=results.map(r=>Date.parse(r.participant.scheduledEntryAt)).sort();
  for(let i=1;i<dates.length;i++)assert.ok(dates[i]-dates[i-1]>=60);
  assert.equal(r.entryScheduler.size+r.walkers.size,5);await until(()=>r.walkers.size===5);
  assert.equal(new Set((await world(r)).map(p=>p.uuid)).size,5);
 }finally{await r.close();}
});

test('approval survives real Node restart before delay and deleted scheduled entries never return',async()=>{
 let r=await runtime({entryDelayMs:800});const s=await register(r);const response=await (await action(r,s,'approve-avatar')).json();
 const scheduled=response.participant.scheduledEntryAt,dataDir=r.dataDir;await r.close();
 const child=fork(path.resolve('tests/fixtures/server-process.cjs'),[dataDir,'0'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,AVATAR_PROVIDER:'local'}});
 try{
  const port=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Restart timeout')),15000);child.once('message',m=>{clearTimeout(t);resolve(m.port);});});
  const base=`http://localhost:${port}`;
  const status=await (await fetch(base+'/api/participants/'+s.participant.uuid+'/avatar-status',{headers:{Authorization:'Bearer '+s.reviewToken}})).json();
  assert.equal(status.participant.scheduledEntryAt,scheduled);
  await until(async()=>{const p=await (await fetch(base+'/api/world')).json();return p.participants.length===1;});
 }finally{await new Promise(resolve=>{child.once('exit',resolve);child.send('shutdown');});}
 r=await runtime();try{
  const next=await register(r);await action(r,next,'approve-avatar');
  const clear=await fetch(r.base+'/api/participants',{method:'DELETE',headers:{'X-SENAI-ADMIN':'reset-participants'}});assert.equal(clear.status,200);
  await wait(250);assert.deepEqual(await world(r),[]);assert.equal(r.entryScheduler.size,0);
 }finally{await r.close();}
});
