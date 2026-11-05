const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createApplication}=require('./helpers/authenticatedApplication');
const {fold}=require('../lib/operatorControl');

async function start(options={}){
  const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});
  const r=await createApplication({dataDir:fs.mkdtempSync(path.join(root,'operator-')),avatarProvider:'local',operatorKey:'',logger:()=>{},...options});
  r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
  r.base=`http://localhost:${r.server.address().port}`;
  return r;
}
async function seed(r,name,{block='blockC_lower',area='area_cnc',status='ACTIVE'}={}){
  const {createWalker}=await import('../public/js/movement.js'),{WORLD}=await import('../public/js/world.js');
  const b=WORLD.blocks[block],poi=b.pointsOfInterest.find(p=>p.areaId===area),node=b.navigationNodes.find(n=>n.id===poi.nodeId);
  const w=createWalker({id:randomUUID(),name,avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc',avatarType:'lpc',
    currentBlock:block,currentArea:area,currentFloor:b.floor,currentRoom:area,currentNode:node.id,position:{x:node.x,y:node.y},
    experienceStatus:status,state:'VISITING',remaining:3600,hasLeftAccess:true},0);
  r.store.insert(w,`${w.id}@example.test`,Date.now());
  if(['ACTIVE','ENTERING'].includes(status))r.walkers.set(w.id,w);
  return w;
}

test('bounded accent-insensitive search retains duplicate UUIDs and excludes every private field',async()=>{
  const r=await start();
  try{
    const a=await seed(r,'Lucas Silva'),b=await seed(r,'Lucas Silva',{block:'blockB_lower',area:'area_metrologia'});
    const joao=await seed(r,'João Souza'),waiting=await seed(r,'Maria Credencial',{status:'AVATAR_REVIEW'});
    for(let i=0;i<280;i++)await seed(r,`Participante ${i}`);
    const search=async q=>(await (await fetch(`${r.base}/api/participants/search?q=${encodeURIComponent(q)}`)).json()).participants;
    const lucas=await search('LUC');assert.deepEqual(new Set(lucas.map(p=>p.uuid)),new Set([a.id,b.id]));
    assert.equal((await search('joao'))[0].uuid,joao.id);assert.equal((await search('JOÃO'))[0].uuid,joao.id);
    const outside=(await search('credencial'))[0];assert.equal(outside.uuid,waiting.id);assert.equal(outside.available,false);
    assert.equal(outside.status,'AVATAR_REVIEW');
    const before=performance.now();assert.equal((await search('participante')).length,20);
    console.log(`Search across 284 participants: ${(performance.now()-before).toFixed(1)} ms`);
    assert.deepEqual(await search('x'),[]);assert.deepEqual(await search("' OR 1=1 --"),[]);
    assert.deepEqual(await search('x'.repeat(81)),[]);
    assert.deepEqual(Object.keys(lucas[0]).sort(),['uuid','name','status','currentBlock','currentArea','available'].sort());
    assert.ok(!JSON.stringify(lucas).includes('email'));assert.equal(fold('João Á É'),'joao a e');
  }finally{await r.close();}
});

test('focus stays indefinitely, follows live area/block, freezes on disappearance; HOME never moves walkers',async()=>{
  let clock=Date.now();const r=await start({now:()=>clock});
  try{
    const w=await seed(r,'Lucas Garofolo'),other=await seed(r,'Maria Silva',{block:'blockA_upper',area:'area_robot_arm'});
    const pending=await seed(r,'Aguardando',{status:'AVATAR_APPROVED'});
    assert.equal(r.operatorControl.focus(pending.id).ok,false);
    assert.equal(r.operatorControl.focus('missing').ok,false);
    assert.equal(r.operatorControl.focus(w.id).ok,true);
    const initial=r.operatorControl.state();clock+=60*60*1000;r.operatorControl.refresh();
    assert.equal(r.operatorControl.state().focusedParticipantUuid,w.id);
    assert.equal(r.operatorControl.state().commandId,initial.commandId);
    w.currentBlock='blockC_upper';w.currentArea='area_eletrica';w.currentFloor='ground_floor';
    r.operatorControl.refresh();assert.equal(r.operatorControl.state().participant.currentBlock,'blockC_upper');
    assert.equal(r.operatorControl.state().participant.currentArea,'area_eletrica');
    assert.equal(r.operatorControl.state().commandId,initial.commandId);
    r.walkers.delete(w.id);r.operatorControl.refresh();
    const missing=r.operatorControl.state();assert.equal(missing.cameraMode,'FOCUS_PARTICIPANT');
    assert.equal(missing.focusedParticipantUuid,w.id);assert.equal(missing.available,false);
    assert.equal(r.operatorControl.focus(other.id).ok,true);
    const before=JSON.stringify([...r.walkers.values()]);r.operatorControl.goHome();
    assert.equal(JSON.stringify([...r.walkers.values()]),before);
    assert.equal(r.operatorControl.state().cameraMode,'HOME');assert.equal(r.operatorControl.state().focusedParticipantUuid,null);
  }finally{await r.close();}
});

test('operator uses the administrative session, denies anonymous access and rejects cross-origin reads',async()=>{
 const r=await start();try{
 await seed(r,'Lucas');
 for(const route of ['/api/participants/search?q=luc','/api/operator/camera','/api/operator/session'])assert.equal((await r.publicFetch(r.base+route)).status,401);
 assert.equal((await fetch(r.base+'/api/operator/camera')).status,200);
 assert.equal((await fetch(r.base+'/api/operator/camera',{headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await (await fetch(r.base+'/api/operator/session')).json()).authorized,true);
 }finally{await r.close();}
});

test('operational focus survives HTTP refresh; full Node restart starts HOME without resetting participants',async()=>{
  let r=await start();
  try{
    const w=await seed(r,'Lucas');r.operatorControl.focus(w.id);
    const snapshot=await (await fetch(r.base+'/api/world')).json();
    assert.equal(snapshot.camera.focusedParticipantUuid,w.id);
    const before=r.store.findByUuid(w.id).currentBlock,dataDir=path.dirname(r.store.db.location()||'');
    // The database path is available directly through DatabaseSync.location on Node 24.
    await r.close();r=await start({dataDir});
    assert.equal(r.operatorControl.state().cameraMode,'HOME');
    assert.equal(r.walkers.get(w.id).currentBlock,before);
  }finally{await r.close();}
});
