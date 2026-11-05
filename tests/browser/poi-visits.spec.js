const {test,expect}=require('../helpers/browserAuth');
const {createApplication}=require('../helpers/authenticatedApplication');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');

async function camera(page,id){return page.evaluate(async id=>{
 const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene'),p=s.characters.participantsById.get(id);
 return {block:s.currentBlock,uuid:s.cameraController.focusedParticipantUuid,following:s.cameraController.following,label:s.cameraController.focusLabel.text,
  type:p?.avatarType,texture:p?.avatarSource,scale:p?.avatar.scaleX,state:p?.state,area:p?.currentArea,facing:p?.facing,
  direction:p?.avatar.lpcDirection,frame:p?.avatar.frame.name,animating:p?.avatar.anims.isPlaying,
  occupied:s.participantsClient?.visitDebug?.pois.filter(p=>p.blockId===s.currentBlock).flatMap(p=>p.slots).filter(p=>p.occupied).length,
  debugLabels:s.visitDebug?[...s.visitDebug.labels.values()].map(l=>l.text):[]};
},id);}

test('POI visits keep LPC idle facing, live debug occupancy and UUID tracking across CNC/milling/crane, portals and refresh',async({page})=>{
 fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/browser-poi-'));
 const r=await createApplication({dataDir,avatarProvider:'local',operatorKey:'',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const {createWalker}=await import('../../public/js/movement.js'),{WORLD}=await import('../../public/js/world.js');
 const block=WORLD.blocks.blockC_lower,node=block.navigationNodes.find(n=>n.id==='poi_area_cnc');
 const w=createWalker({id:randomUUID(),name:'Lucas Visita',avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc',avatarType:'lpc',avatarVersion:'poi-test',
  currentBlock:block.id,currentArea:'area_cnc',currentNode:node.id,currentFloor:block.floor,currentRoom:'area_cnc',position:{x:node.x,y:node.y},
  allowExploration:true,hasLeftAccess:true,experienceStatus:'ACTIVE',state:'VISITING',remaining:3600,speed:8},0,{visitController:r.visitController});
 r.store.insert(w,`${w.id}@example.test`,Date.now());r.walkers.set(w.id,w);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
  await page.goto(base+'/tela?debugWorld=true');
  await page.locator('#participant-search').fill('Lucas Visita');
  const result=page.locator(`li[data-uuid="${w.id}"] button`);await expect(result).toBeVisible();await result.click();
  await expect.poll(async()=>(await camera(page,w.id)).uuid).toBe(w.id);
  const keys=[];
  for(const [poi,area] of [['poi_area_cnc','area_cnc'],['poi_area_fresadora','area_fresadora'],['poi_area_ponte_rolante','area_ponte_rolante']]){
   expect(r.visitController.select(w,poi)).toBe(true);
   await expect.poll(()=>w.currentArea,{timeout:15000}).toBe(area);
   await expect.poll(()=>w.state,{timeout:15000}).toBe('VISITING');
   await expect.poll(async()=>(await camera(page,w.id)).state).toBe('VISITING');
   await expect.poll(async()=>(await camera(page,w.id)).direction).toBe(w.facing);
   await expect.poll(async()=>(await camera(page,w.id)).occupied).toBeGreaterThan(0);
   const state=await camera(page,w.id);keys.push(state.texture);
   expect(state).toMatchObject({uuid:w.id,following:true,label:'Lucas Visita',type:'lpc',scale:1.5,area,animating:false});
   expect(state.debugLabels.some(text=>text.includes(`${poi}\nslots: 1/`))).toBe(true);
   await expect(page.locator('#camera-location')).toContainText(WORLD.blocks.blockC_lower.areas[area].name);
  }
  expect(new Set(keys).size).toBe(1);
  await page.screenshot({path:'test-results/poi-visits-tracking.png'});
  await page.reload();await expect.poll(async()=>(await camera(page,w.id)).uuid).toBe(w.id);
  await expect.poll(async()=>(await camera(page,w.id)).direction).toBe(w.facing);
  expect(r.visitController.explore(w,'blockA_upper')).toBe(true);
  await expect.poll(async()=>(await camera(page,w.id)).block,{timeout:30000}).toBe('blockA_upper');
  await expect.poll(async()=>(await camera(page,w.id)).type).toBe('lpc');
  const final=await camera(page,w.id);expect(final.uuid).toBe(w.id);expect(final.texture).toBe(keys[0]);expect(final.label).toBe('Lucas Visita');
  await page.screenshot({path:'test-results/poi-visits-portal.png'});expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');await r.close();}
});

test('10/50/100 real visitors keep reserved slots bounded while Phaser renders live movement',async({page})=>{
 fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/browser-poi-load-'));
 const r=await createApplication({dataDir,avatarProvider:'local',operatorKey:'',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const {createWalker}=await import('../../public/js/movement.js'),{WORLD}=await import('../../public/js/world.js');
 const blocks=Object.values(WORLD.blocks),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  for(const count of [10,50,100]){
   for(let i=r.walkers.size;i<count;i++){
    const block=blocks[i%blocks.length],spawn=block.spawnPoints.center;
    const w=createWalker({id:randomUUID(),name:`Visitante ${i}`,avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc',avatarType:'lpc',avatarVersion:'load',
     currentBlock:block.id,currentArea:'area_circulation',currentNode:spawn.nodeId,currentFloor:block.floor,currentRoom:'circulation',
     position:{x:spawn.x,y:spawn.y},allowExploration:true,hasLeftAccess:true,experienceStatus:'ACTIVE',remaining:.1},i,{visitController:r.visitController});
    r.store.insert(w,`${w.id}@example.test`,Date.now());r.walkers.set(w.id,w);
   }
   await page.goto(base+'/tela?block=blockC_lower');
   await page.waitForFunction(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').participantsClient?.latest.size>0;});
   const cpu=process.cpuUsage(),started=performance.now();
   const metrics=await page.evaluate(async()=>{
    const frames=[];await new Promise(resolve=>{function frame(t){frames.push(t);if(frames.length<120)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
    const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');
    return {fps:Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0])),visible:s.characters.participants.length,
     heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1024/1024):null};
   });
   const used=process.cpuUsage(cpu),wall=performance.now()-started;
   const snapshot=r.visitController.snapshot(r.walkers);
   for(const poi of snapshot.pois)expect(poi.slots.filter(s=>s.occupied).length).toBeLessThanOrEqual(poi.capacity);
   expect(r.walkers.size).toBe(count);expect(metrics.visible).toBeGreaterThan(0);
   console.log(JSON.stringify({realVisitors:count,...metrics,reserved:r.visitController.occupied,
    nodeCpuPercent:Math.round((used.user+used.system)/1000/wall*100)}));
  }
  await page.screenshot({path:'test-results/poi-visits-100-live.png'});expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');await r.close();}
});

test('production removes POI debug overlays even if debugWorld is requested',async({page})=>{
 const original=process.env.NODE_ENV;process.env.NODE_ENV='production';let r;
 try{
  fs.mkdirSync('.test-data',{recursive:true});const dataDir=fs.mkdtempSync(path.resolve('.test-data/browser-poi-production-'));
  r=await createApplication({dataDir,avatarProvider:'local',logger:()=>{}});
  r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
  await page.goto(`http://localhost:${r.server.address().port}/tela?debugWorld=true`);
  await expect.poll(()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').debugWorld;})).toBe(false);
  expect(await page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').visitDebug;})).toBeNull();
 }finally{
  await page.goto('about:blank');await r?.close();
  if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;
 }
});
