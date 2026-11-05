const {test,expect}=require('../helpers/browserAuth');
const {createApplication,publicParticipant}=require('../helpers/authenticatedApplication');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

async function runtime({socialConfig={interactionChance:0,plazaInteractionChance:0,minCooldownMs:1200,maxCooldownMs:1200}}={}){
 fs.mkdirSync('.test-data',{recursive:true});
 const r=await createApplication({dataDir:fs.mkdtempSync(path.resolve('.test-data/social-browser-')),avatarProvider:'local',operatorKey:'',socialConfig,logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 const {createWalker,updateWalker}=await import('../../public/js/movement.js'),{WORLD}=await import('../../public/js/world.js');
 const seed=(index,blockId='blockA_upper')=>{
  const block=WORLD.blocks[blockId],s=block.spawnPoints.center;
  const w=createWalker({id:randomUUID(),name:`Visitante Social ${index}`,avatar:'/assets/avatars/lpc/test-avatar.png',avatarType:'lpc',avatarKind:'lpc',avatarVersion:'social-test',
   currentBlock:blockId,currentFloor:block.floor,currentArea:'area_circulation',currentNode:s.nodeId,position:{x:s.x,y:s.y},
   allowExploration:true,hasLeftAccess:true,state:'IDLE',experienceStatus:'ACTIVE',remaining:3600,speed:20},index,{visitController:r.visitController});
  r.store.insert(w,`${w.id}@example.test`,Date.now());r.walkers.set(w.id,w);return w;
 };
 const visit=(people,poiId='poi_area_robot_arm')=>{
  const poi=WORLD.blocks[people[0].currentBlock].pointsOfInterest.find(p=>p.id===poiId);
  const before={behaviors:poi.behaviors,behaviorWeights:poi.behaviorWeights,minStayMs:poi.minStayMs,maxStayMs:poi.maxStayMs};
  try{
   Object.assign(poi,{behaviors:['observe'],behaviorWeights:{observe:1},minStayMs:60000,maxStayMs:60000});
   for(const w of people){expect(r.visitController.select(w,poiId)).toBe(true);
    for(let t=0;t<1000&&w.state!=='VISITING';t++)updateWalker(w,100,r.visitController);
    for(let t=0;t<17;t++)updateWalker(w,100,r.visitController);
   }
  }finally{Object.assign(poi,before);}
  r.store.save(people);r.io.to('live').emit('participants:moved',{participants:people.map(publicParticipant)});
 };
 return {r,seed,visit,WORLD,base:`http://localhost:${r.server.address().port}`};
}
async function read(page){return page.evaluate(async()=>{
 const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');
 return {block:s.currentBlock,uuid:s.cameraController.focusedParticipantUuid,mode:s.cameraController.cameraMode,
  label:s.cameraController.focusLabel.text,labelY:s.cameraController.focusLabel.y,labelDepth:s.cameraController.focusLabel.depth,
  people:s.characters.participants.map(p=>({id:p.id,state:p.state,facing:p.avatar.lpcDirection,base:p.visualVisit?.mainFacing,
   texture:p.avatarSource,plan:p.socialInteraction,position:{...p.position}})),
  emotes:[...s.characters.visualEffects.emotes].map(([id,g])=>({id,kind:g.emote,x:g.x,y:g.y,depth:g.depth})),
  names:[...s.characters.participants.map(p=>p.visual.list[2]).filter(label=>label?.visible),
   ...(s.cameraController.focusLabel.visible?[s.cameraController.focusLabel]:[])].map(label=>{const b=label.getBounds();return {x:b.x,y:b.y,width:b.width,height:b.height};}),
  debug:s.debugWorld,panel:s.visitDebug?.panel.text,groups:s.participantsClient?.visitDebug?.social?.groups,
  tweens:s.tweens.getTweens().length,timers:s.time._active.length+s.time._pendingInsertion.length};
});}
async function force(page,a,b,type){return page.evaluate(async request=>{
 const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');
 return new Promise(resolve=>s.participantsClient.socket.timeout(1500).emit('world:social-force',request,(error,result)=>resolve(error?{ok:false,code:'NO_DEBUG_HANDLER'}:result)));
},{a:a.id,b:b.id,type});}

test('debug forces symmetric recognition, wave fallback and staggered shared reaction without losing slots, cleanup, portal or UUID tracking',async({page})=>{
 const {r,seed,visit,base}=await runtime(),a=seed(0),b=seed(1),c=seed(2);visit([a,b,c]);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
  await page.goto(base+'/tela?debugWorld=true');await page.locator('#participant-search').fill(a.name);
  const result=page.locator(`li[data-uuid="${a.id}"] button`);await expect(result).toBeVisible();await result.click();
  await expect.poll(async()=>(await read(page)).people.length).toBe(3);
  expect(new Set([a,b,c].map(w=>r.visitController.info(w).targetSlot)).size).toBe(3);
  const positions=[a,b,c].map(w=>({...w.position})),texture=(await read(page)).people.find(p=>p.id===a.id).texture;
  expect((await force(page,a,b,'ACKNOWLEDGE')).ok).toBe(true);
  await expect.poll(async()=>{const s=await read(page);return s.people.filter(p=>p.plan?.type==='ACKNOWLEDGE').length;},{intervals:[50]}).toBe(2);
  await expect.poll(async()=>{const s=await read(page);return s.people.find(p=>p.id===a.id).facing===a.facing&&s.people.find(p=>p.id===b.id).facing===b.facing;},{intervals:[50]}).toBe(true);
  expect((await force(page,a,c,'LOOK_AT')).code).toBe('LOCKED');
  await expect.poll(()=>r.visitController.social.active).toBe(0);expect((await force(page,a,b,'WAVE')).code).toBe('COOLDOWN');
  expect([a,b,c].map(w=>({...w.position}))).toEqual(positions);expect(r.visitController.occupied).toBe(3);
  await expect.poll(()=>r.visitController.social.inspect(a).socialCooldownMs).toBe(0);
  expect((await force(page,a,b,'WAVE')).ok).toBe(true);
  await expect.poll(async()=>(await read(page)).emotes.some(e=>e.id===a.id),{intervals:[50]}).toBe(true);
  const wave=await read(page);expect(wave.uuid).toBe(a.id);expect(wave.mode).toBe('FOCUS_PARTICIPANT');expect(wave.label).toBe(a.name);
  const icon=wave.emotes.find(e=>e.id===a.id);expect(icon.y-11).toBeGreaterThan(wave.labelY);expect(icon.depth).toBeLessThan(wave.labelDepth);
  for(const box of wave.names)expect(icon.x+12<=box.x||icon.x-12>=box.x+box.width||icon.y+13<=box.y||icon.y-13>=box.y+box.height).toBe(true);
  await page.screenshot({path:'test-results/social-83-wave-tracking.png'});
  // Missing/cancelled peer sprite immediately clears the visual counterpart on this TV.
  await page.evaluate(async id=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').characters.removeParticipant(id);},b.id);
  expect((await read(page)).emotes.some(e=>e.id===a.id)).toBe(false);
  r.store.db.prepare("UPDATE participants SET status='INACTIVE' WHERE uuid=?").run(b.id);r.walkers.delete(b.id);
  r.io.to('live').emit('participants:moved',{participants:[{uuid:b.id,status:'INACTIVE'}]});
  await expect.poll(()=>r.visitController.social.active).toBe(0);expect(a.socialTargetUuid).toBeNull();
  await expect.poll(()=>r.visitController.occupied).toBe(2);
  visit([a,c]);await expect.poll(()=>r.visitController.social.inspect(a).socialCooldownMs).toBe(0);
  expect((await force(page,a,c,'SHARED_REACTION')).ok).toBe(true);
  await expect.poll(async()=>(await read(page)).emotes.some(e=>e.id===a.id),{intervals:[50]}).toBe(true);
  await expect.poll(async()=>(await read(page)).emotes.some(e=>e.id===c.id),{intervals:[50]}).toBe(true);
  await expect.poll(async()=>(await read(page)).panel).toContain('SHARED_REACTION');
  expect((await read(page)).groups.some(g=>g.visitors.includes(a.id.slice(0,8))&&g.visitors.includes(c.id.slice(0,8)))).toBe(true);
  await page.screenshot({path:'test-results/social-83-shared-reaction.png'});
  await expect.poll(()=>r.visitController.social.active).toBe(0);
  expect(r.visitController.explore(a,'blockB_upper')).toBe(true);
  await expect.poll(async()=>(await read(page)).block,{timeout:20000}).toBe('blockB_upper');
  const end=await read(page);expect(end.uuid).toBe(a.id);expect(end.people.find(p=>p.id===a.id).texture).toBe(texture);
  expect(end.emotes).toHaveLength(0);expect(a.socialInteraction).toBeNull();expect(c.socialTargetUuid).toBeNull();
  expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');await r.close();}
});

test('10/50/100 real participants keep bounded social scans, live movement, fixed effects budget and responsive Phaser',async({page})=>{
 const {r,seed,visit,WORLD,base}=await runtime({socialConfig:{}}),a=seed(0),b=seed(1);visit([a,b]);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const blocks=Object.keys(WORLD.blocks);
 try{
  for(const count of [10,50,100]){
   for(let i=r.walkers.size;i<count;i++){const w=seed(i,blocks[i%blocks.length]);w.remaining=.1;w.speed=1.5;}
   await page.goto(base+'/tela?block=blockA_upper');await expect.poll(async()=>(await read(page)).people.length).toBeGreaterThan(0);
   if(count===10){expect(r.visitController.social.interact(a,b,{type:'WAVE',force:true}).ok).toBe(true);
    await expect.poll(async()=>(await read(page)).emotes.length,{intervals:[50]}).toBeGreaterThan(0);}
   const cpu=process.cpuUsage(),started=performance.now();
   const metrics=await page.evaluate(async()=>{
    const frames=[];await new Promise(resolve=>{function frame(t){frames.push(t);if(frames.length<120)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
    const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');
    return {fps:Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0])),visible:s.characters.participants.length,
     heapMB:Math.round(performance.memory.usedJSHeapSize/1024/1024),emotes:s.characters.visualEffects.emotes.size,
     tweens:s.tweens.getTweens().length,timers:s.time._active.length+s.time._pendingInsertion.length};
   });
   const used=process.cpuUsage(cpu),wall=performance.now()-started,social=r.visitController.social.metrics;
   expect(metrics.emotes).toBeLessThanOrEqual(8);expect(metrics.tweens).toBe(0);expect(metrics.timers).toBe(0);expect(social.active).toBeLessThanOrEqual(3);
   expect(social.comparisons).toBeLessThanOrEqual(social.scans*count*2);
   for(const poi of r.visitController.snapshot(r.walkers).pois)expect(poi.slots.filter(s=>s.occupied).length).toBeLessThanOrEqual(poi.capacity);
   console.log('SOCIAL_BROWSER',JSON.stringify({count,...metrics,nodeCpuPercent:Math.round((used.user+used.system)/1000/wall*100),...social}));
  }
  await page.screenshot({path:'test-results/social-83-100-live.png'});expect(errors).toEqual([]);
  r.visitController.clear();expect(r.visitController.social.active).toBe(0);
 }finally{await page.goto('about:blank');await r.close();}
});

test('production disables social diagnostics and never accepts the debug force command',async({page})=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';let f;
 try{
  f=await runtime();const a=f.seed(0),b=f.seed(1);f.visit([a,b]);
  await page.goto(f.base+'/tela?debugWorld=true');await expect.poll(async()=>(await read(page)).debug).toBe(false);
  expect((await force(page,a,b,'WAVE')).code).toBe('NO_DEBUG_HANDLER');expect(f.r.visitController.social.active).toBe(0);
  const snapshot=await (await fetch(f.base+'/api/world?debugWorld=true')).json();expect(snapshot.visits).toBeUndefined();
 }finally{await page.goto('about:blank');await f?.r.close();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
