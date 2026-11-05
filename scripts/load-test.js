const sharp=require('sharp');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID,randomBytes}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createApplication}=require('../server');
const {createAvatarGenerator}=require('../lib/avatarGenerator');

// Synthetic data only. CLI always starts its own isolated server/database.
async function seedParticipants(base,count=50,{headers={}}={}) {
  const photo=await sharp({create:{width:64,height:64,channels:3,background:'#9ebfc6'}}).png().toBuffer();
  const batch=randomUUID(),participants=[],start=performance.now();let next=0;
  await Promise.all(Array.from({length:Math.min(3,count)},async()=>{
    while(next<count) {
      const index=next++;
      const data=new FormData();data.set('selfieAiAcknowledged','true');data.set('name',`Teste ${index+1}`);data.set('email',`${batch}-${index}@example.test`);
      data.set('selfie',new Blob([photo],{type:'image/png'}),'synthetic.png');
      const response=await fetch(`${base}/api/check-in`,{method:'POST',body:data});
      if(response.status!==201)throw new Error(`Check-in ${index}: HTTP ${response.status}`);
      const body=await response.json();
      let participant=body.participant;
      for(let attempt=0;participant.status==='AVATAR_PROCESSING'&&attempt<40;attempt++){
        await new Promise(resolve=>setTimeout(resolve,250));
        participant=(await (await fetch(base+'/api/participants/'+participant.uuid+'/avatar-status',{headers:{Authorization:'Bearer '+body.reviewToken}})).json()).participant;
      }
      const approved=await fetch(base+'/api/participants/'+participant.uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+body.reviewToken}});
      if(!approved.ok)throw new Error('Synthetic approval failed');
      participants.push(participant);
    }
  }));
  for(let attempt=0;attempt<500;attempt++){
    const world=await (await fetch(base+'/api/world',{headers})).json();
    if(participants.every(p=>world.participants.some(w=>w.uuid===p.uuid&&w.status==='ACTIVE')))return {participants,durationMs:Math.round(performance.now()-start)};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Synthetic entries did not become active');
}
if(require.main===module) {
  (async()=>{
    const count=Number(process.argv[2]||50);
    if(!Number.isInteger(count)||count<1||count>50)throw new Error('Use um número entre 1 e 50.');
    const root=path.resolve(__dirname,'../.test-data');fs.mkdirSync(root,{recursive:true});
    const dataDir=fs.mkdtempSync(path.join(root,'load-'));
    const runtime=await createApplication({dataDir,entryDelayMs:0,entrySpacingMs:0,generateAvatar:createAvatarGenerator('local'),logger:()=>{},authConfig:{secret:randomBytes(48).toString('hex')}});
    try {
      runtime.server.listen(0,'127.0.0.1');await new Promise(resolve=>runtime.server.once('listening',resolve));
      const base=`http://127.0.0.1:${runtime.server.address().port}`;
      // Isolated synthetic account; the CLI exercises the same login as a real operator.
      const password=randomBytes(24).toString('hex');await runtime.auth.store.create('load-test-admin',password);
      const pre=await fetch(base+'/api/auth/session'),session=await pre.json();
      const login=await fetch(base+'/login',{method:'POST',headers:{Cookie:pre.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({username:'load-test-admin',password})});
      if(!login.ok)throw new Error('Synthetic operator login failed');const headers={Cookie:login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
      const result=await seedParticipants(base,count,{headers});
      const health=await (await fetch(`${base}/api/health`,{headers})).json();
      const world=await (await fetch(`${base}/api/world`,{headers})).json();
      if(world.participants.length!==count||health.activeParticipants!==count)throw new Error('Contagem incorreta.');
      console.log(JSON.stringify({count,durationMs:result.durationMs,health,dataDir},null,2));
    } finally {await runtime.close();}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={seedParticipants};
