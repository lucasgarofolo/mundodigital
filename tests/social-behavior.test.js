const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {createStore}=require('../lib/store');
const modules=Promise.all([import('../public/js/socialBehavior.js'),import('../public/js/macroNavigation.js'),
  import('../public/js/movement.js'),import('../public/js/world.js'),import('../public/js/avatar/lpcConfig.js')]);
function rng(seed=833){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
async function fixture({count=3,behavior='observe',config={},blockId='blockA_upper',poiId='poi_area_robot_arm'}={}){
 const [social,nav,movement,{WORLD},lpc]=await modules;
 const controller=nav.createVisitController({random:rng(),socialConfig:{checkIntervalMs:1e9,interactionChance:0,plazaInteractionChance:0,...config}});
 const b=WORLD.blocks[blockId],spawn=b.spawnPoints.center,walkers=new Map();
 for(let i=0;i<count;i++){
  const w=movement.createWalker({id:`social-${i}`,uuid:`social-${i}`,name:'Visitante',avatar:'same-lpc',avatarType:'lpc',avatarKind:'lpc',
   allowExploration:true,currentBlock:blockId,currentFloor:b.floor,currentNode:spawn.nodeId,currentArea:'area_circulation',
   position:{x:spawn.x,y:spawn.y},speed:20,hasLeftAccess:true,experienceStatus:'ACTIVE',remaining:3600},i,{visitController:controller});
  walkers.set(w.id,w);
 }
 const tick=(ms=100)=>{for(let t=0;t<ms;t+=100){controller.reconcile(walkers);controller.social.update(walkers,Math.min(100,ms-t));
   for(const w of walkers.values())movement.updateWalker(w,Math.min(100,ms-t),controller);}};
 const visit=(list=[...walkers.values()],destination=poiId)=>{
  const poi=b.pointsOfInterest.find(p=>p.id===destination),previous={behaviors:poi.behaviors,behaviorWeights:poi.behaviorWeights,minStayMs:poi.minStayMs,maxStayMs:poi.maxStayMs};
  try{
   Object.assign(poi,{behaviors:[behavior],behaviorWeights:{[behavior]:1},minStayMs:60000,maxStayMs:60000});
   for(const w of list)assert.ok(controller.select(w,destination));
   for(let i=0;i<1000&&list.some(w=>w.state!=='VISITING');i++)tick();
   assert.ok(list.every(w=>w.state==='VISITING'));tick(1700);
  }finally{Object.assign(poi,previous);}
 };
 visit();return {...social,...nav,...movement,WORLD,...lpc,controller,social:controller.social,walkers,people:[...walkers.values()],tick,visit};
}

test('same-POI visitors keep unique slots/capacity; ACKNOWLEDGE is mutual, short and returns to equipment idle without a lock',async()=>{
 const f=await fixture(),[a,b]=f.people,positions=f.people.map(w=>({...w.position})),stay=f.controller.info(a).stayMs;
 assert.notEqual(f.controller.info(a).targetSlot,f.controller.info(b).targetSlot);
 assert.ok(f.social.interact(a,b,{type:'ACKNOWLEDGE',force:true}).ok);assert.equal(a.socialTargetUuid,b.id);assert.equal(b.socialTargetUuid,a.id);
 const duration=a.socialInteraction.durationMs;assert.ok(duration>=800&&duration<=2600);
 f.tick(500);
 const dx=b.x-a.x,dy=b.y-a.y;
 assert.equal(a.facing,f.directionForMovement((dx-dy)*2,dx+dy));
 assert.equal(b.facing,f.directionForMovement((dy-dx)*2,-dx-dy));
 assert.deepEqual(f.people.map(w=>({...w.position})),positions);
 f.tick(duration+100);assert.equal(a.socialInteraction,null);assert.equal(b.socialTargetUuid,null);assert.equal(f.social.active,0);
 assert.equal(a.state,'VISITING');assert.ok(f.controller.info(a).stayMs<stay);assert.equal(f.controller.occupied,3);
 assert.equal(a.facing,a.visualVisit.mainFacing);
});

test('WAVE falls back to existing pixel emotes; SHARED_REACTION staggers both reactions and preserves equipment facing',async()=>{
 for(const type of ['WAVE','SHARED_REACTION']){
  const f=await fixture(),[a,b]=f.people;assert.ok(f.social.interact(a,b,{type,force:true}).ok);
  const pa=a.socialInteraction,pb=b.socialInteraction,difference=pb.emoteDelayMs-pa.emoteDelayMs;
  assert.ok(difference>=300&&difference<=800);assert.notEqual(pa.emote,pb.emote);
  if(type==='SHARED_REACTION'){assert.equal(pa.facing,a.visualVisit.mainFacing);assert.equal(pb.facing,b.visualVisit.mainFacing);}
  let aSeen=false,bSeen=false;
  for(let ms=0;ms<pa.durationMs+100;ms+=100){
   aSeen||=!!f.sampleSocialInteraction(a.socialInteraction).emote;bSeen||=!!f.sampleSocialInteraction(b.socialInteraction).emote;f.tick();
  }
  assert.ok(aSeen&&bSeen);assert.equal(f.social.active,0);assert.ok(f.people.every(w=>w.state==='VISITING'));
 }
});

test('cooldown survives immediate forced offers; one social emote per visit; a fresh visit gets a fresh visual budget',async()=>{
 const f=await fixture({config:{minCooldownMs:10000,maxCooldownMs:10000}}),[a,b]=f.people;
 assert.ok(f.social.interact(a,b,{type:'WAVE',force:true}).ok);f.tick(2700);
 assert.equal(f.social.interact(a,b,{type:'ACKNOWLEDGE',force:true}).code,'COOLDOWN');
 assert.ok(f.social.inspect(a).socialCooldownMs>9000);f.tick(10100);
 assert.equal(f.social.interact(a,b,{type:'WAVE',force:true}).code,'EMOTE_BUDGET');
 assert.ok(f.social.interact(a,b,{type:'ACKNOWLEDGE',force:true}).ok);f.tick(2700);f.tick(10100);
 f.visit([a,b],'poi_area_3d_printing');assert.ok(f.social.interact(a,b,{type:'WAVE',force:true}).ok);
});

test('three visitors cannot form conflicting pairs or enlarge a full POI',async()=>{
 const f=await fixture(),[a,b,c]=f.people;assert.ok(f.social.interact(a,b,{force:true}).ok);
 assert.equal(f.social.interact(a,c,{force:true}).code,'LOCKED');assert.equal(f.social.interact(b,c,{force:true}).code,'LOCKED');
 const fourth=f.createWalker({...c,id:'fourth',uuid:'fourth',state:'IDLE'},4,{visitController:f.controller});
 assert.equal(f.controller.select(fourth,'poi_area_robot_arm'),false);assert.equal(f.controller.occupied,3);
 const groups=f.social.snapshot(f.walkers).groups;assert.equal(groups[0].visitors.length,3);assert.equal(groups[0].clusters[0].length,3);
});

test('entry, walking, initial access wait, different POIs/areas, primary behaviors and distant positions reject social offers',async()=>{
 const f=await fixture(),[a,b]=f.people;
 for(const [property,value] of [['state','ENTERING'],['state','WALKING'],['state','IDLE'],['experienceStatus','ENTERING'],['status','INACTIVE'],
  ['currentBlock','blockC_lower'],['currentArea','area_3d_printing']]){
  const saved=a[property];a[property]=value;assert.equal(f.social.interact(a,b,{force:true}).ok,false,property);a[property]=saved;
 }
 const position={...a.position};a.position={x:a.x+20,y:a.y};assert.equal(f.social.interact(a,b,{force:true}).code,'DISTANCE');a.position=position;
 for(const behavior of ['machineDemo','curious','lookAround']){
  const g=await fixture({behavior}),[x,y]=g.people;assert.equal(g.social.interact(x,y,{force:true}).ok,false,behavior);
 }
 const started=await fixture({config:{minSettleMs:100000}});assert.equal(started.social.interact(...started.people.slice(0,2),{force:true}).ok,false);
});

test('removal, reset, portal, invalid slot, state/block changes and identity replacement cancel BOTH participants and preserve reservations',async()=>{
 for(const mode of ['remove','reset','portal','invalid','inactive','block','area','walking','replace','newVisit']){
  const f=await fixture(),[a,b]=f.people;assert.ok(f.social.interact(a,b,{type:'WAVE',force:true}).ok);f.tick(400);
  if(mode==='remove')f.walkers.delete(a.id);
  if(mode==='reset')f.controller.clear();
  if(mode==='portal')f.controller.explore(a,'blockB_upper');
  if(mode==='inactive')a.status='INACTIVE';
  if(mode==='block')a.currentBlock='blockC_lower';
  if(mode==='area')a.currentArea='area_3d_printing';
  if(mode==='walking')a.state='WALKING';
  if(mode==='replace')f.walkers.set(a.id,{...a});
  if(mode==='newVisit')f.controller.select(a,'poi_area_3d_printing');
  if(mode==='invalid'){
   const poi=f.WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.id==='poi_area_robot_arm'),slots=poi.visitorSlots;
   try{poi.visitorSlots=[];f.tick();}finally{poi.visitorSlots=slots;}
  }else f.tick();
  assert.equal(a.socialTargetUuid,null,mode);assert.equal(b.socialInteraction,null,mode);assert.equal(f.social.active,0,mode);
  assert.equal(b.state==='VISITING'||mode==='invalid',true,mode);f.controller.clear();assert.equal(f.controller.occupied,0);
 }
});

test('social targets, locks and cooldowns never enter SQLite; fresh restore has no interaction',async()=>{
 const f=await fixture(),[a,b]=f.people;assert.ok(f.social.interact(a,b,{force:true}).ok);
 const encoded=JSON.stringify(a);for(const key of ['socialInteraction','socialTarget','cooldown','relationship','groupId'])assert.ok(!encoded.includes(key));
 fs.mkdirSync('.test-data',{recursive:true});const store=createStore(fs.mkdtempSync(path.resolve('.test-data/social-store-')));
 try{
  store.insert(a,'social@example.test',Date.now());store.save([a]);const saved=store.findByUuid(a.id);
  assert.equal(saved.socialInteraction,undefined);const next=f.createVisitController(),restored=f.createWalker(saved,0,{visitController:next});
  assert.equal(restored.socialInteraction,null);assert.equal(restored.socialTargetUuid,null);assert.equal(next.social.inspect(restored).socialCooldownMs,0);
  assert.equal(restored.currentBlock,a.currentBlock);assert.equal(restored.currentArea,a.currentArea);
 }finally{store.close();}
});

function modelFactory(social,config={},theme='robot'){
 const views=new WeakMap(),walkers=new Map(),poi={id:'poi',areaId:'area',blockId:'block'};
 const engine=social.createSocialController({view:w=>views.get(w),random:rng(),config});
 const add=i=>{const w={id:`id-${i}`,uuid:`id-${i}`,state:'VISITING',experienceStatus:'ACTIVE',currentBlock:'block',currentArea:'area',position:{x:i*.001,y:0},
  get x(){return this.position.x;},get y(){return this.position.y;}};
  const v={poi,slot:{facing:'up'},visual:{id:i+1,behavior:'observe',elapsedMs:2000,mainFacing:'up'},stayMs:60000,valid:true,theme};
  views.set(w,v);w.visualVisit=v.visual;engine.register(w);walkers.set(w.id,w);return w;};
 return {engine,add,walkers,views};
}
test('probability stays low, plaza is more social, zero disables chance, and no failed offer rolls again internally',async()=>{
 const [social]=await modules,counts=[];
 for(const [theme,chance] of [['robot',.08],['plaza',.16],['robot',0],['robot',1]]){
  const f=modelFactory(social,{interactionChance:chance,plazaInteractionChance:chance,minCooldownMs:0,maxCooldownMs:0},theme),a=f.add(0),b=f.add(1);let success=0;
  for(let i=0;i<2000;i++){if(f.engine.interact(a,b,{type:'ACKNOWLEDGE'}).ok){success++;f.engine.cancel(a);}}
  assert.equal(f.engine.metrics.attempts,2000);counts.push(success);
 }
 assert.ok(counts[0]>100&&counts[0]<220);assert.ok(counts[1]>250&&counts[1]<400);assert.equal(counts[2],0);assert.equal(counts[3],2000);
});

test('proximity work is periodic and bounded even in a synthetic crowded POI, not global all-pairs per frame',async()=>{
 const [social]=await modules,f=modelFactory(social,{interactionChance:0});for(let i=0;i<1000;i++)f.add(i);
 for(let i=0;i<60;i++)f.engine.update(f.walkers,16);
 assert.equal(f.engine.metrics.scans,1);assert.ok(f.engine.metrics.comparisons<=2000);
 for(let i=0;i<60;i++)f.engine.update(f.walkers,16);
 assert.equal(f.engine.metrics.scans,2);assert.ok(f.engine.metrics.comparisons<=4000);assert.equal(f.engine.active,0);
});

test('a missing peer sprite or mismatched visit suppresses the visible social effect and facing',async()=>{
 const f=await fixture(),[a,b]=f.people;f.social.interact(a,b,{type:'WAVE',force:true});f.tick(500);
 assert.ok(f.sampleVisibleSocial(a,f.walkers).facing);assert.equal(f.sampleVisibleSocial(a,new Map([[a.id,a]])).emote,null);
 const old=b.state;b.state='WALKING';assert.equal(f.sampleVisibleSocial(a,f.walkers).facing,null);b.state=old;
});

test('10/50/100 participants share the existing movement/slots for five simulated minutes with bounded social scans and no orphan locks',async()=>{
 const [,nav,movement,{WORLD}]=await modules;
 for(const count of [10,50,100]){
  const controller=nav.createVisitController({random:rng(count+833)}),blocks=Object.values(WORLD.blocks),walkers=new Map();
  for(let i=0;i<count;i++){
   const block=count===10?WORLD.blocks.blockA_upper:blocks[i%blocks.length],s=block.spawnPoints.center;
   const w=movement.createWalker({id:`load-${count}-${i}`,name:'Visita',avatar:'same-lpc',avatarType:'lpc',allowExploration:true,
    currentBlock:block.id,currentFloor:block.floor,currentNode:s.nodeId,currentArea:'area_circulation',position:{x:s.x,y:s.y},
    speed:1.5,hasLeftAccess:true,experienceStatus:'ACTIVE',remaining:.1},i,{visitController:controller});walkers.set(w.id,w);
  }
  const cpu=process.cpuUsage(),started=performance.now();let peak=0;
  for(let tick=0;tick<3000;tick++){
   controller.reconcile(walkers);controller.social.update(walkers,100);peak=Math.max(peak,controller.social.active);
   for(const w of walkers.values()){
    movement.updateWalker(w,100,controller);assert.ok(nav.isMacroPositionWalkable(w.currentBlock,w.position));
    if(w.socialInteraction){const peer=walkers.get(w.socialTargetUuid);assert.ok(peer);assert.equal(peer.socialTargetUuid,w.id);assert.equal(w.currentArea,peer.currentArea);}
   }
   assert.ok(controller.occupied<=80);assert.ok(controller.social.active<=3);
  }
  const durationMs=performance.now()-started,used=process.cpuUsage(cpu),metrics=controller.social.metrics;
  assert.ok(metrics.scans<=201);assert.ok(metrics.comparisons<=metrics.scans*count*2);
  assert.ok([...walkers.values()].every(w=>w.visits>0));controller.clear();assert.equal(controller.social.active,0);
  assert.ok([...walkers.values()].every(w=>w.socialTargetUuid===null));
  console.log('SOCIAL_SIM',JSON.stringify({count,simulatedMinutes:5,durationMs:Math.round(durationMs),cpuMs:Math.round((used.user+used.system)/1000),peak,...metrics}));
 }
});
