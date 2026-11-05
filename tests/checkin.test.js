const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const {createApplication}=require('./helpers/authenticatedApplication');
const {cycleAt,CYCLE_MS}=require('../lib/store');
const {createAvatarGenerator}=require('../lib/avatarGenerator');
const {approve}=require('./helpers/experience');

async function runtime(options={}) {
  const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});
  const dataDir=options.dataDir||fs.mkdtempSync(path.join(root,'api-'));
  const app=await createApplication({entryDelayMs:0,entrySpacingMs:0,...options,dataDir});
  app.server.listen(0);await new Promise(resolve=>app.server.once('listening',resolve));
  return {...app,dataDir,base:`http://localhost:${app.server.address().port}`};
}
async function photo(){return sharp({create:{width:64,height:64,channels:3,background:'#89bbaa'}}).png().toBuffer();}
async function checkin(r,{name='Visitante Teste',email='visitante@example.test',buffer,type='image/png'}={}) {
  const data=new FormData();data.set('selfieAiAcknowledged','true');data.set('name',name);data.set('email',email);
  if(buffer!==null)data.set('selfie',new Blob([buffer||await photo()],{type}),'selfie.png');
  return fetch(`${r.base}/api/check-in`,{method:'POST',body:data});
}

test('valida identidade, conteúdo da imagem e limite do upload',async()=>{
  const r=await runtime();
  try {
    assert.equal((await fetch(`${r.base}/check-in`)).status,200);
    for(const data of [{name:'x'},{email:'invalido'},{buffer:null},{buffer:Buffer.from('texto'),type:'image/png'},{type:'image/svg+xml'}]) {
      const res=await checkin(r,data);assert.equal(res.status,400);assert.ok((await res.json()).error);
    }
    assert.equal((await checkin(r,{buffer:Buffer.alloc(5*1024*1024+1)})).status,413);
    assert.equal(r.store.list().length,0);
  } finally {await r.close();}
});

test('salva avatar, normaliza e-mail, deduplica concorrência e não publica dados privados',async()=>{
  let calls=0,selfieReference;
  const local=createAvatarGenerator('local');
  const r=await runtime({generateAvatar:async input=>{calls++;selfieReference=input.selfie;await new Promise(resolve=>setTimeout(resolve,80));return local(input);}});
  try {
    const responses=await Promise.all([checkin(r),checkin(r,{email:' VISITANTE@EXAMPLE.TEST '})]);
    const results=await Promise.all(responses.map(res=>res.json()));
    assert.equal(calls,1);assert.equal(results[0].participant.id,results[1].participant.id);
    const p=results[0].participant;assert.equal(p.status,'AVATAR_REVIEW');assert.equal(p.avatarKind,'local-placeholder');
    assert.equal(r.store.list().length,1);assert.equal(r.store.list()[0].email,'visitante@example.test');
    assert.ok(selfieReference.every(byte=>byte===0));
    assert.equal((await fetch(r.base+p.avatar)).status,200);
    const snapshot=await (await fetch(`${r.base}/api/participants`)).json();
    assert.equal(snapshot.participants.length,0);
    const serialized=JSON.stringify(snapshot);assert.ok(!serialized.includes('email'));assert.ok(!serialized.includes('selfie'));
    assert.equal((await fetch(`${r.base}/data/participants.sqlite`)).status,404);
    assert.equal((await fetch(`${r.base}/avatars/selfie.png`)).status,404);
    const duplicate=await (await checkin(r,{name:'Outro nome'})).json();assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.participant.name,'Visitante Teste');assert.equal(calls,1);
    await approve(r,p,results[0].reviewToken);await new Promise(resolve=>setTimeout(resolve,1800));
    const state=await (await fetch(`${r.base}/api/participants`)).json();
    assert.notDeepEqual(state.participants[0].position,p.position);
  } finally {await r.close();}
});

test('falha de geração permite retry sem avatar órfão nem reserva permanente do e-mail',async()=>{
  let calls=0;const local=createAvatarGenerator('local');
  const r=await runtime({generateAvatar:async input=>{if(++calls===1)throw new Error('Falha simulada');return local(input);}});
  try {
    assert.equal((await checkin(r)).status,502);assert.equal(r.store.list().length,0);
    assert.equal(fs.readdirSync(path.join(r.dataDir,'avatars')).length,0);
    assert.equal((await checkin(r)).status,201);assert.equal(r.store.list().length,1);
  } finally {await r.close();}
});

test('ciclo é atribuído após gerar, atravessa a virada e sobrevive ao restart com posição',async()=>{
  let clock=20000*CYCLE_MS+CYCLE_MS-10;
  const local=createAvatarGenerator('local');
  let r=await runtime({now:()=>clock,generateAvatar:async input=>{clock+=20;return local(input);}});
  const dataDir=r.dataDir;
  let participant;
  try {
    const old=cycleAt(clock);
    const response=await checkin(r);assert.equal(response.status,201);
    const body=await response.json();participant=body.participant;
    assert.notEqual(participant.cycleId,old.id);assert.equal(participant.cycleId,cycleAt(clock).id);
    await approve(r,participant,body.reviewToken);await new Promise(resolve=>setTimeout(resolve,500));
    participant=r.walkers.get(participant.id);const position={...participant.position};
    await r.close();
    r=await runtime({dataDir,now:()=>clock});
    const stored=r.walkers.get(participant.id);
    assert.deepEqual(stored.position,position);assert.equal(stored.cycleId,participant.cycleId);
    const result=await (await checkin(r)).json();assert.equal(result.duplicate,true);assert.equal(result.participant.id,participant.id);
    assert.equal(r.store.db.prepare('SELECT COUNT(*) AS count FROM cycles').get().count,1);
  } finally {await r.close();}
});

test('entrada pela porta e circulação mantêm dados em coordenadas lógicas',async()=>{
  const {createWalker,updateWalker}=await import('../public/js/movement.js');
  const {WORLD,groundFloor,isPositionWalkable}=await import('../public/js/world.js');
  for(let index=0;index<12;index++) {
    const w=createWalker({id:`test-${index}`,name:'Teste'},index,{enter:true});
    const visited=new Set();
    for(let frame=0;frame<2000;frame++) {
      updateWalker(w,100);
      if(w.state==='ENTERING') {
        const door=groundFloor.rooms.sala5_acesso.door;
        assert.ok(w.x>door.start&&w.x<door.start+door.width);
        assert.ok(w.y>=groundFloor.entry.path.at(-1).y-WORLD.movement.laneRadius-.001&&w.y<=groundFloor.entry.start.y+.5);
      } else assert.ok(isPositionWalkable(w.position));
      assert.equal(w.x,w.position.x);assert.equal(w.currentFloor,'ground_floor');assert.equal(w.currentRoom,'sala5_acesso');
      if(w.state==='VISITING')visited.add(w.destination.id);
    }
    assert.ok(visited.size>1);
  }
});
