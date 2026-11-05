const {test}=require('node:test'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs'),path=require('node:path');
const {createStore}=require('../lib/store');
const {createApplication}=require('./helpers/authenticatedApplication');
const modules=Promise.all([import('../public/js/world.js'),import('../public/js/movement.js'),import('../public/js/macroNavigation.js'),import('../public/js/macroWorldConfig.js')]);
function rng(seed=12345){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
async function fixture(blockId='blockC_lower',options={}){
 const [{WORLD},movement,nav]=await modules,block=WORLD.blocks[blockId],spawn=block.spawnPoints.center;
 const controller=nav.createVisitController({random:rng(),...options});let index=0;
 const walker=(data={})=>movement.createWalker({id:`poi-${index}`,name:'Visitante',avatar:'same-lpc',avatarType:'lpc',allowExploration:true,
  currentBlock:block.id,currentArea:'area_circulation',currentNode:spawn.nodeId,currentFloor:block.floor,
  position:{x:spawn.x,y:spawn.y},speed:6,hasLeftAccess:true,experienceStatus:'ACTIVE',...data},index++,{visitController:controller});
 return {WORLD,...movement,...nav,block,controller,walker};
}
function advance(f,w,predicate,limit=5000){for(let i=0;i<limit&&!predicate(w);i++)f.updateWalker(w,100,f.controller);assert.ok(predicate(w),'walker did not reach expected state');}

test('every observation slot is unique, outside machines/portals, and safely connected to every existing route lane',async()=>{
 const [{WORLD},,{isMacroPositionWalkable}]=await modules;const positions=new Map();
 for(const block of Object.values(WORLD.blocks))for(const poi of block.pointsOfInterest.filter(p=>p.visitable!==false)){
  assert.equal(poi.capacity,poi.visitorSlots.length);assert.ok(poi.minStayMs>=4000);assert.ok(poi.maxStayMs>=poi.minStayMs);assert.ok(poi.weight>0);
  const node=block.navigationNodes.find(n=>n.id===poi.nodeId);assert.ok(node);
  for(const slot of poi.visitorSlots){
   assert.ok(['up','left','down','right'].includes(slot.facing));
   assert.ok(isMacroPositionWalkable(block.id,slot),`${block.id}/${poi.id}/${slot.id}: ${JSON.stringify(slot)}`);
   const area=block.areas[poi.areaId],b=area.bounds;
   assert.ok(slot.x>=b.x+.24&&slot.x<=b.x+b.width-.24&&slot.y>=b.y+.24&&slot.y<=b.y+b.height-.24);
   for(const portal of block.portals){const p=block.navigationNodes.find(n=>n.id===portal.nodeId);assert.ok(Math.hypot(slot.x-p.x,slot.y-p.y)>1);}
   for(const prior of positions.get(block.id)||[])assert.ok(Math.hypot(prior.x-slot.x,prior.y-slot.y)>=.48,`${poi.id} overlaps another slot`);
   if(!positions.has(block.id))positions.set(block.id,[]);positions.get(block.id).push(slot);
   for(let lane=0;lane<8;lane++)for(let i=0;i<=30;i++){
    const start={x:node.x+Math.cos(lane*Math.PI/4)*.34,y:node.y+Math.sin(lane*Math.PI/4)*.34},t=i/30;
    assert.ok(isMacroPositionWalkable(block.id,{x:start.x+(slot.x-start.x)*t,y:start.y+(slot.y-start.y)*t}),`${poi.id} connector ${lane}/${i}`);
   }
  }
 }
 assert.ok(WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.areaId==='area_praca_civica').capacity>
  WORLD.blocks.blockC_lower.pointsOfInterest.find(p=>p.areaId==='area_cnc').capacity);
 assert.equal(WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.areaId==='area_inovacao').visitable,false);
});

test('one participant reserves, walks, arrives, faces the POI, observes within its interval, releases and chooses another',async()=>{
 const f=await fixture(undefined,{behavior:{localDestinationProbability:1}}),w=f.walker();
 assert.equal(f.controller.select(w,'poi_area_cnc'),true);assert.equal(f.controller.occupied,1);
 assert.equal(w.state,'WALKING');assert.equal(w.currentArea,'area_circulation');
 const target=f.controller.info(w),poi=f.block.pointsOfInterest.find(p=>p.id===target.targetPoi);
 advance(f,w,w=>w.state==='VISITING');const slot=poi.visitorSlots.find(s=>s.id===target.targetSlot);
 assert.deepEqual(w.position,{x:slot.x,y:slot.y});assert.equal(w.facing,slot.facing);assert.equal(w.currentArea,'area_cnc');
 assert.equal(w.currentBlock,'blockC_lower');assert.equal(w.avatar,'same-lpc');
 const duration=f.controller.info(w).stayMs;assert.ok(duration>=poi.minStayMs&&duration<=poi.maxStayMs);
 for(let ms=0;ms<poi.minStayMs-100;ms+=100)f.updateWalker(w,100,f.controller);
 assert.equal(w.state,'VISITING');assert.equal(f.controller.valid(w),true);
 advance(f,w,w=>w.state==='WALKING');assert.notEqual(f.controller.info(w).targetPoi,poi.id);
 assert.ok(!f.controller.snapshot(new Map([[w.id,w]])).pois.find(p=>p.poiId===poi.id).slots.some(s=>s.occupied));
});

test('two visitors reserve different CNC slots; a third waits safely and capacity becomes available on departure/removal/reset',async()=>{
 const f=await fixture(undefined,{behavior:{localDestinationProbability:1}}),[a,b,c]=[f.walker(),f.walker(),f.walker()];
 assert.ok(f.controller.select(a,'poi_area_cnc'));assert.ok(f.controller.select(b,'poi_area_cnc'));
 assert.notEqual(f.controller.info(a).targetSlot,f.controller.info(b).targetSlot);assert.equal(f.controller.occupied,2);
 assert.equal(f.controller.select(c,'poi_area_cnc'),false);assert.equal(f.controller.info(c).targetPoi,null);
 advance(f,a,w=>w.state==='VISITING');advance(f,b,w=>w.state==='VISITING');assert.notDeepEqual(a.position,b.position);
 const walkers=new Map([[a.id,a],[b.id,b],[c.id,c]]);walkers.delete(a.id);f.controller.reconcile(walkers);assert.equal(f.controller.occupied,1);
 assert.ok(f.controller.select(c,'poi_area_cnc'));assert.equal(f.controller.occupied,2);
 b.status='INACTIVE';f.controller.reconcile(walkers);assert.equal(f.controller.occupied,1);
 f.controller.clear();assert.equal(f.controller.occupied,0);
});

test('invalidated reservation cancels its route safely; logical inactivity stops movement; controllers do not share occupancy',async()=>{
 const f=await fixture(),w=f.walker();f.controller.select(w,'poi_area_cnc');
 const poi=f.block.pointsOfInterest.find(p=>p.id==='poi_area_cnc'),original=poi.visitorSlots;
 try{
  poi.visitorSlots=[];f.updateWalker(w,100,f.controller);assert.equal(f.controller.occupied,0);assert.equal(f.controller.info(w).targetPoi,null);
  assert.ok(w.route.every(n=>n.x!==original[0].x||n.y!==original[0].y));
 }finally{poi.visitorSlots=original;}
 f.controller.select(w,'poi_area_cnc');w.status='INACTIVE';const position={...w.position};f.updateWalker(w,100,f.controller);
 assert.equal(f.controller.occupied,0);assert.deepEqual(w.position,position);
 const other=await fixture();assert.ok(other.controller.select(other.walker(),'poi_area_cnc'));assert.equal(f.controller.occupied,0);
});

test('short history prevents cycling the last three POIs when alternatives exist',async()=>{
 const f=await fixture(undefined,{behavior:{localDestinationProbability:1}}),w=f.walker();const seen=[];
 for(let i=0;i<30;i++){
  f.controller.select(w);const target=f.controller.info(w).targetPoi;assert.ok(target);assert.ok(!seen.slice(-3).includes(target));
  advance(f,w,w=>w.state==='VISITING');seen.push(target);
 }
 assert.ok(new Set(seen).size>=5);assert.equal(f.controller.info(w).recentPoiIds.length,3);
});

test('configurable local probability and centralized weights affect actual choices',async()=>{
 const f=await fixture();let local=0,remote=0;
 for(let i=0;i<2000;i++){
  const p=f.walker();f.controller.select(p);
  if(p.destination?.targetBlock)remote++;else local++;
  f.controller.release(p);
 }
 assert.ok(remote>200&&remote<400,`${local} local / ${remote} remote`);
 const a=await fixture('blockA_upper',{random:rng(42),behavior:{localDestinationProbability:1}}),v=a.walker(),counts={};
 for(let i=0;i<2000;i++){a.controller.select(v);const id=a.controller.info(v).targetPoi;counts[id]=(counts[id]||0)+1;}
 assert.ok(counts.poi_area_robot_arm>counts.poi_praca_display);assert.ok(counts.poi_area_robot_arm>counts.poi_area_praca_civica);
});

test('door entry retains a jittered initial stay in access before exploring; new participants do not all leave together',async()=>{
 const f=await fixture('blockB_upper'),walkers=[];
 for(let i=0;i<10;i++){
  const w=f.createWalker({id:`entrant-${i}`,name:'Entrada',allowExploration:true,experienceStatus:'ENTERING'},i,{enter:true,visitController:f.controller});
  advance(f,w,w=>w.state!=='ENTERING');w.experienceStatus='ACTIVE';walkers.push(w);
  assert.equal(w.currentArea,'area_access');assert.ok(f.controller.info(w).waitMs>=4000&&f.controller.info(w).waitMs<=9000);
  for(let ms=0;ms<3900;ms+=100)f.updateWalker(w,100,f.controller);
  assert.equal(w.currentArea,'area_access');assert.equal(w.currentBlock,'blockB_upper');assert.equal(w.state,'IDLE');
 }
 assert.ok(new Set(walkers.map(w=>Math.round(f.controller.info(w).waitMs))).size>5);
});

test('a multi-block goal traverses paired portals, preserves UUID/LPC, and changes block only at the portal',async()=>{
 const f=await fixture(),w=f.walker();assert.ok(f.controller.explore(w,'blockA_upper'));
 assert.equal(w.currentBlock,'blockC_lower');assert.equal(w.currentArea,'area_circulation');
 const transitions=[];let prior=w.currentBlock;
 for(let i=0;i<12000&&w.currentBlock!=='blockA_upper';i++){
  f.updateWalker(w,100,f.controller);
  if(prior!==w.currentBlock){assert.ok(f.WORLD.blocks[prior].portals.some(p=>p.targetBlock===w.currentBlock));transitions.push(w.currentBlock);prior=w.currentBlock;}
 }
 assert.deepEqual(transitions,['blockC_upper','blockB_upper','blockA_upper']);assert.equal(w.id,'poi-0');assert.equal(w.avatar,'same-lpc');
 assert.equal(w.currentNode,'exit_to_blockB_upper');assert.equal(f.controller.occupied,0);
 advance(f,w,w=>w.state==='VISITING');assert.equal(w.currentBlock,'blockA_upper');assert.notEqual(w.currentArea,'area_circulation');
});

test('visit clocks/history/reservations are not serialized; restore keeps spatial identity and starts a fresh decision',async()=>{
 const f=await fixture(),w=f.walker({id:'restore-poi',avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc'});
 f.controller.select(w,'poi_area_cnc');advance(f,w,w=>w.state==='VISITING');
 const encoded=JSON.stringify(w);for(const name of ['targetPoi','targetSlot','stayMs','recentPoi','visitorSlots','slot_'])assert.ok(!encoded.includes(name));
 fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/poi-restore-')),store=createStore(dataDir);
 try{
  store.insert(w,'poi@example.test',Date.now());store.save([w]);const p=store.findByUuid(w.id);
  const next=f.createVisitController(),restored=f.createWalker(p,0,{visitController:next});
  assert.equal(restored.currentBlock,w.currentBlock);assert.equal(restored.currentArea,w.currentArea);assert.deepEqual(restored.position,w.position);
  assert.equal(next.info(restored).targetPoi,null);assert.deepEqual(next.info(restored).recentPoiIds,[]);assert.equal(next.occupied,0);
  assert.equal(restored.state,'WALKING');
 }finally{store.close();}
});

test('10/50/100 visitors: safe movement, distributed reservations and bounded decision work in the central update loop',async()=>{
 for(const count of [10,50,100]){
  const f=await fixture(undefined,{random:rng(100+count)}),blocks=Object.values(f.WORLD.blocks);
  const walkers=Array.from({length:count},(_,i)=>{
   const b=blocks[i%blocks.length],s=b.spawnPoints.center;
   return f.walker({id:`load-${i}`,currentBlock:b.id,currentFloor:b.floor,currentArea:'area_circulation',currentNode:s.nodeId,position:{x:s.x,y:s.y},speed:1.4});
  });
  const map=new Map(walkers.map(w=>[w.id,w])),pois=new Set(),start=performance.now();let maxOccupied=0;
  for(let tick=0;tick<6000;tick++){
   f.controller.reconcile(map);const occupied=new Set();
   for(const w of walkers){
    f.updateWalker(w,100,f.controller);assert.ok(f.isMacroPositionWalkable(w.currentBlock,w.position));
    const info=f.controller.info(w);
    if(info.targetPoi){const key=`${w.currentBlock}/${info.targetPoi}/${info.targetSlot}`;assert.ok(!occupied.has(key));occupied.add(key);pois.add(info.targetPoi);}
   }
   assert.equal(occupied.size,f.controller.occupied);maxOccupied=Math.max(maxOccupied,occupied.size);
  }
  assert.ok(pois.size>=15);assert.ok(walkers.every(w=>w.visits>0));
  console.log(`POI load ${count}: ${(performance.now()-start).toFixed(0)} ms / 10 simulated minutes; ${pois.size} destinations; peak reservations ${maxOccupied}`);
 }
});

test('HTTP snapshots keep visit internals private; explicit development debug exposes occupancy; reset releases slots',async()=>{
 const f=await fixture();fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/poi-http-'));
 const r=await createApplication({dataDir,avatarProvider:'local',logger:()=>{}});r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 const base=`http://localhost:${r.server.address().port}`;
 try{
  const w=f.walker({id:'debug-poi',avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc'});
  r.store.insert(w,'debug@example.test',Date.now());r.walkers.set(w.id,w);r.visitController.register(w);r.visitController.select(w,'poi_area_cnc');
  const plain=await (await fetch(base+'/api/world')).json();assert.equal(plain.visits,undefined);
  const debug=await (await fetch(base+'/api/world?debugWorld=true')).json();assert.equal(debug.visits.participants[0].targetPoi,'poi_area_cnc');
  assert.ok(debug.visits.pois.find(p=>p.poiId==='poi_area_cnc').slots.some(s=>s.occupied));
  for(const forbidden of ['email','reviewToken','photoPath'])assert.ok(!JSON.stringify(debug).includes(forbidden));
  const result=await fetch(base+'/api/participants',{method:'DELETE',headers:{'X-SENAI-ADMIN':'reset-participants'}});
  assert.equal(result.status,200);assert.equal(r.visitController.occupied,0);
 }finally{await r.close();}
});

test('production omits visit diagnostics even when explicitly requested',async t=>{
 const original=process.env.NODE_ENV;process.env.NODE_ENV='production';
 t.after(()=>{if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;});
 fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/poi-production-'));
 const r=await createApplication({dataDir,avatarProvider:'local',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 try{const snapshot=await (await fetch(`http://localhost:${r.server.address().port}/api/world?debugWorld=true`)).json();assert.equal(snapshot.visits,undefined);assert.equal(snapshot.debugWorldEnabled,false);}
 finally{await r.close();}
});
