const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {createStore}=require('../lib/store');
const {createApplication}=require('./helpers/authenticatedApplication');

test('incomplete spatial saves recover in their own area, legacy saves keep Sala 5',async()=>{
  const {createWalker}=await import('../public/js/movement.js');
  const w=createWalker({id:'incomplete',name:'Visitante',currentBlock:'blockC_lower',currentArea:'area_cnc',position:{x:null,y:null}},0);
  assert.equal(w.currentBlock,'blockC_lower');assert.equal(w.currentArea,'area_cnc');
  assert.equal(w.currentNode,'poi_area_cnc');assert.equal(w.currentFloor,'lower_floor');
  assert.equal(w.route.length,0);assert.ok(Number.isFinite(w.x));
  const old=createWalker({id:'old',name:'Legado'},0);
  assert.equal(old.currentBlock,'blockB_upper');assert.equal(old.currentArea,'area_access');
});

test('five connected blocks: every graph segment, slot, POI and paired portal is safe',async()=>{
  const {WORLD,routeBetween}=await import('../public/js/world.js');
  const {isMacroPositionWalkable}=await import('../public/js/macroNavigation.js');
  assert.equal(Object.keys(WORLD.blocks).length,5);
  for(const block of Object.values(WORLD.blocks)){
    const nodes=new Map(block.navigationNodes.map(n=>[n.id,n]));
    for(const node of nodes.values())assert.doesNotThrow(()=>routeBetween(block.spawnPoints.center.nodeId,node.id,block));
    for(const area of Object.values(block.areas)){
      assert.deepEqual(area.agents,[]);
      if(area.id!=='area_circulation')assert.ok(block.pointsOfInterest.some(p=>p.areaId===area.id));
    }
    for(const [a,b] of block.connections)for(let slot=0;slot<8;slot++)for(let sample=0;sample<=30;sample++){
      const from=nodes.get(a),to=nodes.get(b),t=sample/30;
      const p={x:from.x+(to.x-from.x)*t+Math.cos(slot*Math.PI/4)*.34,
        y:from.y+(to.y-from.y)*t+Math.sin(slot*Math.PI/4)*.34};
      assert.ok(isMacroPositionWalkable(block.id,p),`${block.id} ${a} → ${b}: ${JSON.stringify(p)}`);
    }
    for(const portal of block.portals){
      const other=WORLD.blocks[portal.targetBlock],pair=other.portals.find(p=>p.nodeId===portal.targetNode);
      assert.equal(pair.targetBlock,block.id);assert.equal(pair.targetNode,portal.nodeId);
      assert.equal(portal.type,block.floor===other.floor?'passage':'stairs');
    }
  }
});

test('all eight directed transitions retain UUID, LPC, name and valid landing nodes',async()=>{
  const {WORLD}=await import('../public/js/world.js');
  const {createWalker,updateWalker}=await import('../public/js/movement.js');
  const {planMacroRoute}=await import('../public/js/macroNavigation.js');
  for(const block of Object.values(WORLD.blocks))for(const portal of block.portals){
    const center=block.spawnPoints.center;
    const w=createWalker({id:'same-uuid',name:'Lucas',avatar:'same-lpc',avatarType:'lpc',allowExploration:true,
      currentBlock:block.id,currentFloor:block.floor,currentArea:'area_circulation',currentNode:center.nodeId,
      position:{x:center.x,y:center.y}},0);
    planMacroRoute(w,portal.nodeId);w.destination=portal;
    for(let n=0;n<1000&&w.currentBlock===block.id;n++)updateWalker(w,100);
    assert.equal(w.currentBlock,portal.targetBlock);assert.equal(w.currentNode,portal.targetNode);
    assert.equal(w.currentFloor,WORLD.blocks[w.currentBlock].floor);
    assert.equal(w.id,'same-uuid');assert.equal(w.name,'Lucas');assert.equal(w.avatar,'same-lpc');
    assert.equal(w.avatarType,'lpc');assert.equal(w.state,'IDLE');
  }
});

test('10/50/100 walkers: exploration, valid positions and no return to access after leaving',async()=>{
  const {WORLD}=await import('../public/js/world.js');
  const {createWalker,updateWalker}=await import('../public/js/movement.js');
  const {isMacroPositionWalkable}=await import('../public/js/macroNavigation.js');
  for(const count of [10,50,100]){
    const walkers=Array.from({length:count},(_,i)=>createWalker({id:`load-${i}`,name:'Visitante',allowExploration:true},i));
    const blocks=new Set(),areas=new Set(),start=performance.now();
    for(let tick=0;tick<12000;tick++)for(const w of walkers){
      updateWalker(w,100);blocks.add(w.currentBlock);areas.add(w.currentArea);
      assert.ok(WORLD.blocks[w.currentBlock]);
      assert.ok(isMacroPositionWalkable(w.currentBlock,w.position),JSON.stringify({block:w.currentBlock,node:w.currentNode,position:w.position}));
      if(w.hasLeftAccess)assert.notEqual(w.currentArea,'area_access');
    }
    assert.equal(blocks.size,5);assert.ok(areas.size>15);
    console.log(`Macro simulation ${count}: ${(performance.now()-start).toFixed(0)} ms for 20 simulated minutes`);
  }
});

test('SQLite v7 + server restart restore three different blocks and routes without duplicate identities',async()=>{
  const {WORLD}=await import('../public/js/world.js');
  const {createWalker}=await import('../public/js/movement.js');
  const {planMacroRoute}=await import('../public/js/macroNavigation.js');
  const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});
  const dataDir=fs.mkdtempSync(path.join(root,'macro-restore-')),store=createStore(dataDir);
  const ids=['blockA_upper','blockB_lower','blockC_lower'];
  const expected=ids.map((id,i)=>{
    const block=WORLD.blocks[id],spawn=block.spawnPoints.center;
    const w=createWalker({id:`restore-${i}`,name:`Visitante ${i}`,avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc',avatarType:'lpc',
      currentBlock:id,currentArea:'area_circulation',currentFloor:block.floor,currentRoom:'circulation',
      currentNode:spawn.nodeId,position:{x:spawn.x,y:spawn.y},hasLeftAccess:true,allowExploration:true},i);
    planMacroRoute(w,block.pointsOfInterest[0].nodeId);w.destination=block.pointsOfInterest[0];
    store.insert(w,`restore-${i}@example.test`,Date.now());return w;
  });
  store.save(expected);store.close();
  const runtime=await createApplication({dataDir,avatarProvider:'local',logger:()=>{}});
  try{
    for(const w of expected){
      const restored=runtime.walkers.get(w.id);
      assert.equal(restored.currentBlock,w.currentBlock);assert.equal(restored.currentArea,w.currentArea);
      assert.deepEqual(restored.position,w.position);assert.deepEqual(restored.route,w.route);
    }
    runtime.server.listen(0);await new Promise(r=>runtime.server.once('listening',r));
    const world=await (await fetch(`http://localhost:${runtime.server.address().port}/api/world`)).json();
    assert.equal(new Set(world.participants.map(p=>p.id)).size,3);
    assert.deepEqual(world.participants.map(p=>p.currentBlock).sort(),ids.sort());
    assert.ok(!JSON.stringify(world).includes('reviewToken'));
  }finally{await runtime.close();}
});
