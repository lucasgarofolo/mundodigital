const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const {createStore}=require('../lib/store');
const {createApplication}=require('./helpers/authenticatedApplication');
const {seedParticipants}=require('../scripts/load-test');

const temp=()=>{const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});return fs.mkdtempSync(path.join(root,'persistence-'));};
async function start(dataDir=temp()) {
  const runtime=await createApplication({dataDir,entryDelayMs:0,entrySpacingMs:0,logger:()=>{}});
  runtime.server.listen(0);await new Promise(resolve=>runtime.server.once('listening',resolve));
  return {...runtime,dataDir,base:`http://localhost:${runtime.server.address().port}`};
}

test('migração aditiva recupera SQLite da Fase 2 sem alterar identidade, posição, avatar ou ciclo',async()=>{
  const dataDir=temp(),id=randomUUID();
  const {createWalker}=await import('../public/js/movement.js');
  const walker=createWalker({id,name:'Mesmo Nome',avatar:`/avatars/${id}.png`,avatarKind:'local-placeholder',
    createdAt:'2026-01-01T00:00:00.000Z',cycleId:'cycle-antigo'},0);
  const db=new DatabaseSync(path.join(dataDir,'participants.sqlite'));
  db.exec(`CREATE TABLE cycles(id TEXT PRIMARY KEY,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL);
    CREATE TABLE participants(id TEXT PRIMARY KEY,email TEXT UNIQUE COLLATE NOCASE,name TEXT,avatar TEXT,
      avatar_kind TEXT,created_at TEXT,cycle_id TEXT,simulation TEXT);`);
  db.prepare('INSERT INTO cycles VALUES(?,?,?)').run('cycle-antigo','2026-01-01','2026-01-02');
  db.prepare('INSERT INTO participants VALUES(?,?,?,?,?,?,?,?)').run(id,'old@example.test',walker.name,walker.avatar,
    walker.avatarKind,walker.createdAt,walker.cycleId,JSON.stringify(walker));db.close();
  for(let pass=0;pass<2;pass++) {
    const store=createStore(dataDir);
    try {
      const p=store.findByUuid(id);assert.equal(p.uuid,id);assert.equal(p.status,'CHECKED_IN');
      assert.equal(p.photoPath,null);assert.deepEqual(p.position,walker.position);
      assert.equal(p.avatar,walker.avatar);assert.equal(p.cycleId,walker.cycleId);
      assert.equal(p.checkinAt,p.createdAt);assert.equal(store.listActive().length,1);
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,8);
      assert.equal(p.currentBlock,'blockB_upper');assert.equal(p.currentArea,'area_access');
    } finally {store.close();}
  }
});

test('selfie é removida após pipelines; assets e metadados sobrevivem ao restart e health consulta o banco',async()=>{
  let r=await start();
  try {
    const {participants}=await seedParticipants(r.base,3);const first=participants[0];
    const stored=r.store.findByUuid(first.uuid);assert.equal(stored.uuid,first.id);
    assert.equal(stored.currentRoom,'sala5_acesso');assert.equal(stored.currentFloor,'ground_floor');
    assert.equal(stored.checkinAt,stored.createdAt);assert.ok(stored.updatedAt);
    await r.selfieLifecycle.idle();const file=path.resolve(r.dataDir,'photos',`${first.uuid}.png`);
    assert.equal(r.store.findByUuid(first.uuid).photoPath,null);assert.equal(fs.existsSync(file),false);
    assert.equal((await fetch(`${r.base}/photos/${first.uuid}.png`)).status,404);
    const dataDir=r.dataDir;await r.close();r=await start(dataDir);
    assert.equal(fs.existsSync(file),false);assert.equal(r.store.findByUuid(first.uuid).selfieStatus,'DELETED');
    assert.equal((await fetch(r.base+first.avatarUrl)).status,200);
    const world=await (await fetch(`${r.base}/api/world`)).json();assert.equal(world.participants.length,3);
    assert.equal(new Set(world.participants.map(p=>p.uuid)).size,3);
    assert.ok(!JSON.stringify(world).includes('email'));assert.ok(!JSON.stringify(world).includes('photo'));
    assert.equal((await (await fetch(`${r.base}/api/health`)).json()).database,'connected');
    r.store.db.prepare("UPDATE participants SET status='INACTIVE' WHERE uuid=?").run(first.uuid);
    assert.equal((await (await fetch(`${r.base}/api/world`)).json()).participants.length,2);
    const detail=await (await fetch(`${r.base}/api/participants/${first.uuid}`)).json();
    assert.equal(detail.participant.status,'INACTIVE');
    assert.equal((await fetch(`${r.base}/api/participants/${encodeURIComponent("' OR 1=1 --")}`)).status,404);
    assert.throws(()=>r.store.db.prepare('UPDATE participants SET uuid=? WHERE uuid<>?').run(first.uuid,first.uuid),/UNIQUE/);
    assert.throws(()=>r.store.db.prepare('UPDATE participants SET status=? WHERE uuid=?').run('WRONG',first.uuid),/CHECK/);
  } finally {await r.close();}
});

test('50 check-ins: SQLite, UUIDs, arquivos, API e checkpoints espaçados',async()=>{
  const r=await start();
  try {
    let writes=0;const save=r.store.save.bind(r.store);r.store.save=(...args)=>{writes++;return save(...args);};
    const result=await seedParticipants(r.base,50);assert.equal(result.participants.length,50);
    assert.equal(new Set(result.participants.map(p=>p.uuid)).size,50);
    assert.equal(r.store.listActive().length,50);
    await r.selfieLifecycle.idle();assert.equal(fs.readdirSync(path.join(r.dataDir,'photos')).length,0);
    assert.equal(fs.readdirSync(path.join(r.dataDir,'avatars')).length,50);
    const response=await fetch(`${r.base}/api/world`);assert.equal(response.status,200);
    assert.equal((await response.json()).participants.length,50);
    assert.equal((await (await fetch(`${r.base}/api/health`)).json()).activeParticipants,50);
    const before=writes;await new Promise(resolve=>setTimeout(resolve,5300));
    assert.ok(writes-before>=1&&writes-before<40,'Checkpoints periódicos e chegadas significativas, não por frame.');
    const p=r.store.listActive()[0],w=r.walkers.get(p.id);
    // A periodic save can be almost five seconds old. Bound drift by elapsed
    // time and actual walking speed, rather than a fixed four-tile assumption.
    const ageSeconds=Math.max(0,(Date.now()-Date.parse(p.updatedAt))/1000);
    assert.equal(p.currentBlock,w.currentBlock);
    assert.ok(ageSeconds<6);
    assert.ok(Math.hypot(p.position.x-w.x,p.position.y-w.y)<=w.speed*(ageSeconds+.15)+.05);
  } finally {await r.close();}
});
