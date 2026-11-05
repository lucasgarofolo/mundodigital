const {test}=require('node:test'),assert=require('node:assert/strict');
const {publicParticipant}=require('./helpers/authenticatedApplication');
const modules=Promise.all([import('../public/js/visitVisualBehavior.js'),import('../public/js/macroNavigation.js'),
  import('../public/js/movement.js'),import('../public/js/world.js')]);
function rng(seed=825){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
async function fixture(behavior='curious',blockId='blockC_lower',poiId='poi_area_cnc'){
 const [visual,nav,movement,{WORLD}]=await modules,controller=nav.createVisitController({random:rng()}),block=WORLD.blocks[blockId];
 const poi=block.pointsOfInterest.find(p=>p.id===poiId),spawn=block.spawnPoints.center;
 const w=movement.createWalker({id:'visual-test',name:'Visita',allowExploration:true,experienceStatus:'ACTIVE',hasLeftAccess:true,
  currentBlock:blockId,currentFloor:block.floor,currentArea:'area_circulation',currentNode:spawn.nodeId,position:{x:spawn.x,y:spawn.y},speed:20},0,{visitController:controller});
 const previous={behaviors:poi.behaviors,behaviorWeights:poi.behaviorWeights};
 try{
  poi.behaviors=[behavior];poi.behaviorWeights={[behavior]:1};controller.select(w,poiId);
  for(let tick=0;tick<1000&&w.state!=='VISITING';tick++)movement.updateWalker(w,100,controller);
  assert.equal(w.state,'VISITING');
 }finally{Object.assign(poi,previous);}
 return {...visual,...movement,WORLD,controller,w,poi};
}
test('visual defaults, inspect/unsupported demo fallback, disabling, and allowed four-direction facing',async()=>{
 const [{createVisualVisit,sampleVisualVisit,VISUAL_BEHAVIOR}]=await modules;
 for(const requested of [undefined,'inspect','missing','machineDemo']){
  const plan=createVisualVisit({id:'plain',behaviors:requested?[requested]:undefined},'north',10000,()=>.5);
  assert.equal(plan.behavior,'observe');assert.equal(sampleVisualVisit(plan).facing,'down');
 }
 const off=createVisualVisit({behaviors:['curious']},'up',10000,()=>.5,1,{...VISUAL_BEHAVIOR,enabled:false});
 assert.equal(off.behavior,'observe');
 for(const facing of ['up','right','down','left']){
  const plan=createVisualVisit({behaviors:['lookAround']},facing,10000,()=>.5);
  assert.notEqual(plan.secondaryFacing,facing);assert.ok(['up','right','down','left'].includes(plan.secondaryFacing));
 }
});
test('POI declarations are restrained in access, independent for innovation, and demos are explicitly supported',async()=>{
 const [,,, {WORLD}]=await modules;
 for(const b of Object.values(WORLD.blocks))for(const p of b.pointsOfInterest.filter(p=>p.visitable!==false)){
  assert.ok(p.behaviors.includes('observe'));
  if(p.areaId==='area_access')assert.deepEqual(p.behaviors,['observe','lookAround']);
  if(p.machineAnimation)assert.ok(['robotArmDemo','printerDemo','cncDemo','craneDemo'].includes(p.machineAnimation));
 }
 assert.equal(WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.id==='poi_area_robot_arm').machineAnimation,'robotArmDemo');
});
test('observe keeps the exact reserved position, facing and original stay; visuals never serialize into SQLite',async()=>{
 const f=await fixture('observe'),pos={...f.w.position},face=f.w.facing,stay=f.controller.info(f.w).stayMs;
 for(let i=0;i<20;i++)f.updateWalker(f.w,100,f.controller);
 assert.deepEqual(f.w.position,pos);assert.equal(f.w.facing,face);assert.equal(f.w.state,'VISITING');
 assert.equal(f.controller.info(f.w).stayMs,stay-2000);assert.equal(f.controller.info(f.w).phase,'IDLE');
 assert.equal(JSON.stringify(f.w).includes('visualVisit'),false);assert.equal(JSON.stringify(f.w).includes('emote'),false);
 assert.equal(publicParticipant(f.w).visualVisit.behavior,'observe');
});
test('curious has one finite emote window, randomized bounded timing, four local symbols, then idle and departure',async()=>{
 const f=await fixture('curious'),position={...f.w.position};let starts=0,previous=false;
 const original=f.w.visualVisit.id;
 while(f.w.visualVisit?.id===original){
  const playing=!!f.controller.info(f.w).emote;if(playing&&!previous)starts++;previous=playing;
  assert.deepEqual(f.w.position,position);f.updateWalker(f.w,100,f.controller);
 }
 assert.equal(starts,1);assert.equal(f.controller.info(f.w).emote,null);
 const random=rng(),symbols=new Set(),delays=new Set();
 for(let i=0;i<200;i++){
  const plan=f.createVisualVisit({behaviors:['curious']},'left',10000,random,i);
  symbols.add(plan.emote);delays.add(plan.delayMs);
  assert.ok(plan.delayMs>=2000&&plan.delayMs<=4500);assert.ok(plan.durationMs>=1400&&plan.durationMs<=2400);
  assert.ok(plan.delayMs+plan.durationMs<10000);
 }
 assert.deepEqual([...symbols].sort(),f.EMOTES.toSorted());assert.ok(delays.size>100);
});
test('lookAround only changes facing after a slow delay and returns to the principal direction without walking',async()=>{
 const f=await fixture('lookAround'),p=f.w.visualVisit,pos={...f.w.position},faces=new Set();
 while(f.w.visualVisit?.id===p.id&&f.w.visualVisit.elapsedMs<p.delayMs+p.durationMs+200){
  faces.add(f.w.facing);assert.deepEqual(f.w.position,pos);assert.equal(f.w.state,'VISITING');f.updateWalker(f.w,100,f.controller);
 }
 assert.deepEqual(faces,new Set([p.mainFacing,p.secondaryFacing]));assert.equal(f.w.facing,p.mainFacing);
});
test('machineDemo has a finite phase, keeps its slot available to other visitors, and cleans up on every interruption',async()=>{
 for(const mode of ['release','remove','inactive','reset','invalid','portal','state']){
  const f=await fixture('machineDemo','blockA_upper','poi_area_robot_arm');
  while(f.controller.info(f.w).phase!=='PLAYING')f.updateWalker(f.w,100,f.controller);
  assert.equal(f.controller.info(f.w).machineAnimation,'robotArmDemo');assert.equal(f.controller.occupied,1);
  const other=f.createWalker({...f.w,id:'other',position:{...f.w.position},state:'IDLE'},1,{visitController:f.controller});
  assert.ok(f.controller.select(other,f.poi.id));assert.equal(f.controller.occupied,2);
  if(mode==='release')f.controller.release(f.w);
  if(mode==='remove')f.controller.reconcile(new Map([[other.id,other]]));
  if(mode==='inactive'){f.w.status='INACTIVE';f.updateWalker(f.w,100,f.controller);}
  if(mode==='reset')f.controller.clear();
  if(mode==='invalid'){
   const original=f.poi.visitorSlots;try{f.poi.visitorSlots=[];f.updateWalker(f.w,100,f.controller);}finally{f.poi.visitorSlots=original;}
  }
  if(mode==='portal')f.controller.explore(f.w,'blockB_upper');
  if(mode==='state'){f.w.state='IDLE';f.controller.reconcile(new Map([[f.w.id,f.w],[other.id,other]]));}
  assert.equal(f.w.visualVisit,null,mode);assert.equal(f.controller.info(f.w).emote,null);
  f.controller.clear();assert.equal(f.controller.occupied,0);
 }
});
test('a populated innovation POI keeps most visits observing; ten arrivals have mixed plans and timings',async()=>{
 const [{createVisualVisit},,,{WORLD}]=await modules,poi=WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.id==='poi_area_robot_arm');
 const random=rng(2026),counts={},delays=new Set();
 for(let i=0;i<2000;i++){const p=createVisualVisit(poi,'right',12000,random,i);counts[p.behavior]=(counts[p.behavior]||0)+1;if(i<10)delays.add(p.delayMs);}
 assert.ok(counts.observe>1100&&counts.observe<1300);assert.ok(counts.curious>400&&counts.curious<600);
 assert.ok(counts.machineDemo>200&&counts.machineDemo<400);assert.ok(delays.size>=8);
});
