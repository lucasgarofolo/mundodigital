// Real local model smoke test with a synthetic image and an isolated database.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const sharp=require('sharp');
const {createApplication}=require('../server');
async function main(){
 try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir('.test-data',{recursive:true});
 const dataDir=await fs.mkdtemp(path.resolve('.test-data/ollama-smoke-'));
 const r=await createApplication({dataDir,avatarProvider:'ollama',entryDelayMs:0,entrySpacingMs:0,avatarTimeoutMs:180000});
 try{
  r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
  const base=`http://localhost:${r.server.address().port}`;
  const photo=await sharp({create:{width:128,height:128,channels:3,background:'#aabbcc'}}).png().toBuffer();
  const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name','Teste local');form.set('email','ollama-smoke@example.test');
  form.set('selfie',new Blob([photo],{type:'image/png'}),'synthetic.png');
  const response=await fetch(base+'/api/check-in',{method:'POST',body:form});assert.equal(response.status,201);
  const {participant,reviewToken}=await response.json();
  await new Promise(resolve=>setTimeout(resolve,20));await r.avatarPipeline.idle();
  const saved=r.store.findByUuid(participant.uuid);
  assert.equal(saved.avatarStatus,'READY','Ollama did not return a valid catalog response.');
  assert.equal(saved.experienceStatus,'AVATAR_REVIEW');assert.equal(r.walkers.size,0);
  const approval=await fetch(`${base}/api/participants/${participant.uuid}/approve-avatar`,{method:'POST',headers:{Authorization:'Bearer '+reviewToken}});
  assert.equal(approval.status,200);
  for(let i=0;i<60&&r.store.findByUuid(participant.uuid).experienceStatus!=='ACTIVE';i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(r.store.findByUuid(participant.uuid).experienceStatus,'ACTIVE');assert.equal(r.walkers.size,1);
  console.log('PASS: real Ollama → validated JSON → LPC → review → approval → ACTIVE. Synthetic image; no likeness validation.');
 }finally{await r.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
