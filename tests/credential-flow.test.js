const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('./helpers/authenticatedApplication');
const {passData,passConfig,storyHash}=require('../lib/passView');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
test('credential states use existing LPC states, bounded portrait wait, and entry flags do not invalidate Story',()=>{
 assert.equal(passConfig({}).portraitWaitMs,15000);
 const p={uuid:'a'.repeat(36),name:'Lucas',status:'CHECKED_IN',avatar:'/avatars/avatar.png',avatarStatus:'READY',experienceStatus:'AVATAR_REVIEW',portraitStatus:'PROCESSING',portraitRequestedAt:new Date().toISOString()};
 assert.equal(passData(p).credentialState,'ASSETS_PROCESSING');assert.equal(passData(p).shareAllowed,false);
 const ready={...p,portraitRequestedAt:new Date(Date.now()-16000).toISOString()};
 assert.equal(passData(ready).credentialState,'PASS_READY');assert.equal(passData(ready).canEnter,true);
 assert.equal(passData({...p,portraitStatus:'FAILED'}).credentialState,'PASS_READY');
 assert.equal(passData({...p,portraitStatus:'READY',avatarStatus:'PENDING',experienceStatus:'AVATAR_PROCESSING'}).credentialState,'ASSETS_PROCESSING');
 const scheduled=passData({...ready,experienceStatus:'AVATAR_APPROVED'}),active=passData({...ready,experienceStatus:'ACTIVE'});
 assert.equal(scheduled.credentialState,'ENTRY_SCHEDULED');assert.equal(active.credentialState,'ACTIVE');assert.equal(scheduled.canEnter,false);assert.equal(scheduled.shareAllowed,true);
 assert.equal(storyHash(scheduled),storyHash(active));assert.equal(storyHash(passData({...ready,portraitStatus:'PENDING'})),storyHash(passData(ready)));
 assert.notEqual(storyHash(active),storyHash({...active,portraitStatus:'READY',portraitUrl:'/generated/portrait.png'}));
});
test('check-in starts both assets, credential is visible before entry, sharing waits for click, and no LPC changes',async()=>{
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/credential-'));
 let finishLpc,finishPortrait,calls=0,exports=0;
 const lpc=new Promise(resolve=>{finishLpc=resolve;}),portrait=new Promise(resolve=>{finishPortrait=resolve;});
 const photo=await sharp({create:{width:64,height:64,channels:3,background:'#d9d9d9'}}).png().toBuffer();
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:30,logger:()=>{},analyzeSelfie:async()=>{await lpc;return DEFAULT_AVATAR;},
  generatePortrait:async()=>{calls++;await portrait;return photo;},storyRenderer:{render:async(_data,{outputPath})=>{exports++;await fs.writeFile(outputPath,photo);},close:async()=>{}}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 try{
  const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name','Lucas');form.set('email','credential-private@example.test');form.set('selfie',new Blob([photo],{type:'image/png'}),'private.png');
  const response=await fetch(base+'/api/check-in',{method:'POST',body:form});assert.equal(response.status,201);const s=await response.json(),uuid=s.participant.uuid;
  assert.ok(s.participant.passUrl);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,1);assert.equal(r.walkers.size,0);
  const approve=()=>fetch(`${base}/api/participants/${uuid}/approve-avatar`,{method:'POST',headers:{Authorization:'Bearer '+s.reviewToken}});
  assert.equal((await approve()).status,409);finishPortrait();await r.passService.idle();assert.equal(exports,0);
  let dto=(await (await fetch(base+'/api/pass/'+uuid)).json()).pass;assert.equal(dto.credentialState,'ASSETS_PROCESSING');assert.equal(dto.storyUrl,null);
  finishLpc();await r.avatarPipeline.idle();const avatar=r.store.findByUuid(uuid).avatar;
  dto=(await (await fetch(base+'/api/pass/'+uuid)).json()).pass;assert.equal(dto.credentialState,'PASS_READY');assert.equal(dto.canEnter,true);assert.equal(dto.shareAllowed,false);assert.equal(r.walkers.size,0);
  assert.equal((await fetch(`${base}/generated/participants/${uuid}/story.png`)).status,404);
  const approvals=await Promise.all([approve().then(r=>r.json()),approve().then(r=>r.json())]);assert.equal(approvals[0].participant.scheduledEntryAt,approvals[1].participant.scheduledEntryAt);
  await r.passService.idle();assert.equal(exports,1);assert.equal(calls,1);assert.equal(r.store.findByUuid(uuid).avatar,avatar);
  dto=(await (await fetch(base+'/api/pass/'+uuid)).json()).pass;assert.equal(dto.shareAllowed,true);assert.ok(dto.storyUrl);
  await fetch(base+'/api/pass/'+uuid);await approve();await r.passService.idle();assert.equal(exports,1);assert.equal(calls,1);
 }finally{finishLpc();finishPortrait();await r.close();}
});
