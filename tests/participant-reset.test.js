const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('./helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
test('local reset deletes active/inactive registrations, cancels jobs, removes files and frees the same email',async()=>{
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/reset-'));
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const r=await createApplication({dataDir,logger:()=>{},avatarProvider:'local',analyzeSelfie:async()=>{await gate;return DEFAULT_AVATAR;}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const checkin=async i=>{const body=new FormData();body.set('selfieAiAcknowledged','true');body.set('name','Teste');body.set('email',`reset-${i}@example.test`);body.set('selfie',new Blob([image],{type:'image/png'}),'test.png');return fetch(base+'/api/check-in',{method:'POST',body});};
 const reset=(headers={})=>fetch(base+'/api/participants',{method:'DELETE',headers:{'X-SENAI-ADMIN':'reset-participants',...headers}});
 try{
  const first=await (await checkin(0)).json();await checkin(1);await checkin(2);
  r.store.db.prepare("UPDATE participants SET status='INACTIVE' WHERE id=?").run(first.participant.id);
  assert.equal((await (await fetch(base+'/api/operation/config')).json()).canResetParticipants,true);
  assert.equal((await fetch(base+'/api/participants',{method:'DELETE'})).status,403);
  assert.equal((await reset({Origin:'https://external.example'})).status,403);assert.equal(r.store.list().length,3);
  assert.equal((await r.publicFetch(base+'/api/participants',{method:'DELETE'})).status,401);
  await fs.writeFile(path.join(dataDir,'avatars/keep.txt'),'unrelated');
  const response=await reset();assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:3,cleanupFailures:0});
  assert.equal(r.store.list().length,0);assert.equal(r.walkers.size,0);assert.equal(r.avatarPipeline.stats.running,0);
  assert.deepEqual(await fs.readdir(path.join(dataDir,'photos')),[]);assert.deepEqual(await fs.readdir(path.join(dataDir,'avatars')),['keep.txt']);
  release();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(r.store.list().length,0);
  const again=await checkin(0);assert.equal(again.status,201);const newParticipant=(await again.json()).participant;
  assert.notEqual(newParticipant.id,first.participant.id);await new Promise(resolve=>setTimeout(resolve,20));await r.avatarPipeline.idle();
  assert.equal(r.store.list().length,1);assert.equal(r.store.findByUuid(newParticipant.id).avatarStatus,'READY');
 }finally{release();await r.close();}
});
