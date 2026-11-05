const {test,expect}=require('../helpers/browserAuth');
const {createApplication}=require('../helpers/authenticatedApplication');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

async function runtime(){
 fs.mkdirSync('.test-data',{recursive:true});
 const r=await createApplication({dataDir:fs.mkdtempSync(path.resolve('.test-data/visual-82-')),avatarProvider:'local',operatorKey:'',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 const {createWalker,updateWalker}=await import('../../public/js/movement.js'),{WORLD}=await import('../../public/js/world.js');
 const seed=(index=0,blockId='blockC_lower')=>{
  const b=WORLD.blocks[blockId],s=b.spawnPoints.center;
  const w=createWalker({id:randomUUID(),name:`Lucas Visual ${index}`,avatar:'/assets/avatars/lpc/test-avatar.png',avatarType:'lpc',avatarKind:'lpc',avatarVersion:'visual-82',
   currentBlock:blockId,currentFloor:b.floor,currentNode:s.nodeId,currentArea:'area_circulation',position:{x:s.x,y:s.y},
   allowExploration:true,hasLeftAccess:true,experienceStatus:'ACTIVE',state:'IDLE',remaining:3600,speed:20},index,{visitController:r.visitController});
  r.store.insert(w,`${w.id}@example.test`,Date.now());r.walkers.set(w.id,w);return w;
 };
 const visit=(w,poiId,behavior)=>{
  const poi=WORLD.blocks[w.currentBlock].pointsOfInterest.find(p=>p.id===poiId);
  const previous={behaviors:poi.behaviors,behaviorWeights:poi.behaviorWeights,minStayMs:poi.minStayMs,maxStayMs:poi.maxStayMs};
  try{
   Object.assign(poi,{behaviors:[behavior],behaviorWeights:{[behavior]:1},minStayMs:8000,maxStayMs:8000});
   expect(r.visitController.select(w,poiId)).toBe(true);
   // Walk through the real graph; leave the authoritative timer running for the visual window.
   for(let i=0;i<1000&&w.state!=='VISITING';i++)updateWalker(w,100,r.visitController);
   expect(w.state).toBe('VISITING');
  }finally{Object.assign(poi,previous);}
 };
 return {r,seed,visit,base:`http://localhost:${r.server.address().port}`};
}
async function state(page,id){return page.evaluate(async id=>{
 const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene'),p=s.characters.participantsById.get(id),g=s.characters.visualEffects.emotes.get(id);
 return {state:p?.state,block:s.currentBlock,position:p?{...p.position}:null,facing:p?.avatar.lpcDirection,plan:p?.visualVisit,
  texture:p?.avatarSource,animating:p?.avatar.anims.isPlaying,emotes:s.characters.visualEffects.emotes.size,
  emote:g?{x:g.x,y:g.y,depth:g.depth,kind:g.emote}:null,avatar:p?{x:p.visual.x,y:p.visual.y,depth:p.visual.depth}:null,
  uuid:s.cameraController.focusedParticipantUuid,following:s.cameraController.following,label:s.cameraController.focusLabel.text,
  labelY:s.cameraController.focusLabel.y,labelDepth:s.cameraController.focusLabel.depth,
  machines:[...s.machineVisuals].map(([poi,m])=>({poi,state:m.state,owner:m.owner,depth:m.graphics.depth,commands:[...m.graphics.commandBuffer]})),
  tweens:s.tweens.getTweens().length,timers:s.time._active.length+s.time._pendingInsertion.length};
},id);}

test('real visits show one tracked pixel emote, clean up on removal, animate CNC, look around, and cross portals without leftovers',async({page})=>{
 const {r,seed,visit,base}=await runtime(),w=seed(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
  await page.goto(base+'/tela?debugWorld=true');await page.locator('#participant-search').fill(w.name);
  const result=page.locator(`li[data-uuid="${w.id}"] button`);await expect(result).toBeVisible();await result.click();
  await expect.poll(async()=>(await state(page,w.id)).uuid).toBe(w.id);
  visit(w,'poi_area_cnc','curious');
  await expect.poll(async()=>!!(await state(page,w.id)).emote,{timeout:10000,intervals:[50]}).toBe(true);
  await expect.poll(async()=>{const p=(await state(page,w.id)).position;return Math.hypot(p.x-w.x,p.y-w.y);},{intervals:[50]}).toBeLessThan(.05);
  const curious=await state(page,w.id);
  expect(curious).toMatchObject({state:'VISITING',following:true,label:w.name,animating:false});
  expect(curious.emote.x-curious.avatar.x).toBeCloseTo(38,0);expect(curious.emote.y-curious.avatar.y).toBeCloseTo(-70,0);
  expect(curious.emote.y-11).toBeGreaterThan(curious.labelY);expect(curious.emote.depth).toBeLessThan(curious.labelDepth);
  expect(curious.emote.depth).toBeGreaterThan(Math.max(...curious.machines.map(m=>m.depth)));
  await page.screenshot({path:'test-results/visual-82-emote-tracking.png'});
  // A refresh recovers the same current visit, rather than inventing a second gesture.
  await page.reload();await expect.poll(async()=>(await state(page,w.id)).plan?.id).toBe(w.visualVisit.id);
  await expect.poll(async()=>(await state(page,w.id)).emotes,{timeout:10000}).toBe(0);
  expect((await state(page,w.id)).state).toBe('VISITING');
  const before=(await state(page,w.id)).machines.find(m=>m.poi==='poi_area_cnc').commands;
  visit(w,'poi_area_cnc','machineDemo');
  await expect.poll(async()=>(await state(page,w.id)).machines.find(m=>m.poi==='poi_area_cnc').state,{timeout:10000,intervals:[50]}).toBe('PLAYING');
  expect((await state(page,w.id)).following).toBe(true);
  await page.screenshot({path:'test-results/visual-82-cnc-demo.png'});
  await expect.poll(async()=>(await state(page,w.id)).machines.find(m=>m.poi==='poi_area_cnc').state,{timeout:10000}).toBe('IDLE');
  expect((await state(page,w.id)).machines.find(m=>m.poi==='poi_area_cnc').commands).toEqual(before);
  visit(w,'poi_area_fresadora','lookAround');const plan=w.visualVisit,position={...w.position};
  await expect.poll(async()=>(await state(page,w.id)).facing,{timeout:10000,intervals:[50]}).toBe(plan.secondaryFacing);
  expect(w.position).toEqual(position);
  await expect.poll(async()=>(await state(page,w.id)).facing,{timeout:10000,intervals:[50]}).toBe(plan.mainFacing);
  visit(w,'poi_area_cnc','curious');
  await expect.poll(async()=>(await state(page,w.id)).emotes,{timeout:10000,intervals:[50]}).toBe(1);
  expect(r.visitController.explore(w,'blockA_upper')).toBe(true);
  await expect.poll(async()=>(await state(page,w.id)).emotes).toBe(0);
  await expect.poll(async()=>(await state(page,w.id)).block,{timeout:20000}).toBe('blockA_upper');
  const final=await state(page,w.id);expect(final.uuid).toBe(w.id);expect(final.following).toBe(true);expect(final.texture).toBe(curious.texture);
  // Remove during an active emote and let the existing HTTP recovery remove the sprite.
  visit(w,'poi_area_robot_arm','curious');
  await expect.poll(async()=>(await state(page,w.id)).emotes,{timeout:10000,intervals:[50]}).toBe(1);
  r.walkers.delete(w.id);r.visitController.reconcile(r.walkers);
  r.io.to('live').emit('participants:moved',{participants:[{uuid:w.id,status:'INACTIVE'}]});
  await expect.poll(async()=>(await state(page,w.id)).emotes).toBe(0);expect(w.visualVisit).toBeNull();
  expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');await r.close();}
});

test('all four existing equipment parts reset exactly; pixel effects follow avatars and caps bound 10/50/100 visitors without timers',async({page})=>{
 const {r,seed,base}=await runtime(),w=seed(0,'blockA_upper'),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/tela?block=blockA_upper');
  await expect.poll(async()=>(await state(page,w.id)).state).toBe('IDLE');
  const results=await page.evaluate(async id=>{
   const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');s.participantsClient.socket.disconnect();
   const {createVisualVisit}=await import('/js/visitVisualBehavior.js'),{WORLD}=await import('/js/world.js');
   const manager=s.characters,original=manager.participantsById.get(id),results=[];
   const base={...s.participantsClient.latest.get(id),avatar:original.avatarSource,avatarType:'lpc',state:'VISITING',currentBlock:s.currentBlock};
   s.participantsClient.active=false;s.participantsClient.latest.clear();
   const plan=(poi,behavior,index)=>{const p=createVisualVisit({...poi,behaviors:[behavior],behaviorWeights:{[behavior]:1}},'right',12000,()=>.5,index);p.elapsedMs=p.delayMs+p.durationMs*.1;return p;};
   // Robot/printer in this block, CNC/crane after the existing block switch.
   for(const blockId of ['blockA_upper','blockC_lower']){
    s.setBlock(blockId);
    const before=new Map([...s.machineVisuals].map(([id,m])=>[id,[...m.graphics.commandBuffer]]));
    for(const [poiId,machine] of s.machineVisuals){
     const poi=WORLD.blocks[blockId].pointsOfInterest.find(p=>p.id===poiId),slot=poi.visitorSlots[0],key=`machine-${poiId}`;
     const p=manager.addParticipant({...base,id:key,uuid:key,name:'Demo',currentBlock:blockId,position:slot,visualVisit:plan(poi,'machineDemo',1)},{authoritative:true});
     manager.visualEffects.update(manager.participants);if(machine.state!=='PLAYING')throw new Error('Machine did not start: '+JSON.stringify({poiId,block:s.currentBlock,state:p.state,status:p.status,plan:p.visualVisit,machines:[...s.machineVisuals.keys()]}));
     const changed=JSON.stringify(machine.graphics.commandBuffer)!==JSON.stringify(before.get(poiId));
     manager.removeParticipant(key);if(machine.state!=='IDLE')throw new Error('Machine did not stop');
     results.push({poiId,changed,reset:JSON.stringify(machine.graphics.commandBuffer)===JSON.stringify(before.get(poiId))});
    }
   }
   s.setBlock('blockA_upper');for(const p of [...manager.participants])manager.removeParticipant(p.id);
   const poi=WORLD.blocks.blockA_upper.pointsOfInterest.find(p=>p.id==='poi_area_robot_arm');
   for(const count of [10,50,100]){
    for(let i=manager.participants.length;i<count;i++){
     const visualVisit=plan(poi,i%5===0?'machineDemo':i%5===1?'observe':'curious',i);
     if(visualVisit.emote)visualVisit.emote=['attention','curious','sparkle','thinking'][i%4];
     manager.addParticipant({...base,id:`load-${i}`,uuid:`load-${i}`,name:`Visitante ${i}`,position:{x:2+i%10*1.8,y:5+Math.floor(i/10)*.7},visualVisit},{authoritative:true});
    }
    manager.update(16);const p=manager.participants[2],g=manager.visualEffects.emotes.get(p.id),oldX=g.x;
    p.position.x+=.1;manager.syncVisual(p);manager.visualEffects.update(manager.participants);
    if(g.x===oldX)throw new Error('Emote did not follow');
    const frames=[];await new Promise(resolve=>{function frame(t){frames.push(t);if(frames.length<60)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
    results.push({count,emotes:manager.visualEffects.emotes.size,machines:[...s.machineVisuals.values()].filter(m=>m.state==='PLAYING').length,
     fps:Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0])),heapMB:Math.round(performance.memory.usedJSHeapSize/1024/1024),
     tweens:s.tweens.getTweens().length,timers:s.time._active.length+s.time._pendingInsertion.length});
    // Restart the controlled windows for the next measurement, not gameplay behavior.
    for(const q of manager.participants)q.visualVisit.elapsedMs=q.visualVisit.delayMs+q.visualVisit.durationMs*.2;
   }
   manager.visualEffects.clear();
   results.push({afterClear:manager.visualEffects.emotes.size,allIdle:[...s.machineVisuals.values()].every(m=>m.state==='IDLE')});
   return results;
  },w.id);
  for(const result of results){
   if(result.poiId)expect(result).toMatchObject({changed:true,reset:true});
   if(result.count){expect(result.emotes).toBeLessThanOrEqual(8);expect(result.machines).toBeLessThanOrEqual(2);expect(result.tweens).toBe(0);expect(result.timers).toBe(0);}
  }
  expect(results.at(-1)).toEqual({afterClear:0,allIdle:true});console.log('VISUAL_82',JSON.stringify(results));expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/visual-82-100-visitors.png'});
 }finally{await page.goto('about:blank');await r.close();}
});
