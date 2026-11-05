const {test,expect}=require('../helpers/browserAuth');

const sceneState=page=>page.evaluate(async()=>{
  const {game}=await import('/js/game.js');const s=game.scene.getScene('WorldScene'),c=s.cameraController;
  const b=s.blockBounds,v=c.camera.worldView;
  return {block:s.currentBlock,zoom:c.zoom,target:c.targetZoom,sceneCount:game.scene.scenes.length,
    fits:v.contains(b.x,b.y)&&v.contains(b.x+b.width,b.y+b.height),children:s.children.length,
    people:s.characters.participants.map(p=>({id:p.id,name:p.name,block:p.currentBlock,area:p.currentArea,
      texture:p.avatarSource,type:p.avatarType,scale:p.avatar.scaleX,label:p.visual.list[2].text})),
    latest:s.participantsClient?.latest.size||0};
});
async function ready(page){
  await page.waitForFunction(async()=>{const {game}=await import('/js/game.js');return !!game.scene.getScene('WorldScene').cameraController;});
}

test('five blocks, debug graph, fixed HUD, camera/resize and repeated switches without scenery leaks',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/tela?demo=1&debugWorld=true');await ready(page);
  const blocks=['blockA_upper','blockB_upper','blockB_lower','blockC_upper','blockC_lower'];
  for(const id of blocks){
    await page.selectOption('#block-selector',id);await page.waitForTimeout(150);
    let state=await sceneState(page);expect(state.block).toBe(id);expect(state.sceneCount).toBe(1);expect(state.fits).toBe(true);
    const children=state.children;
    await page.screenshot({path:`test-results/${id}-debug.png`});
    const hud=await page.locator('.hud').boundingBox();
    await page.mouse.move(900,500);await page.keyboard.press('+');
    await expect.poll(async()=>(await sceneState(page)).zoom).toBeCloseTo(1.1,3);
    expect(await page.locator('.hud').boundingBox()).toEqual(hud);
    await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(150);
    expect((await sceneState(page)).target).toBeCloseTo(1.1,3);
    await page.keyboard.press('0');await expect.poll(async()=>(await sceneState(page)).zoom).toBe(1);
    expect((await sceneState(page)).fits).toBe(true);
    await page.setViewportSize({width:1920,height:1080});
    const other=id==='blockA_upper'?'blockC_lower':'blockA_upper';
    for(let n=0;n<3;n++){await page.selectOption('#block-selector',other);await page.selectOption('#block-selector',id);}
    expect((await sceneState(page)).children).toBe(children);
  }
  expect(errors).toEqual([]);
});

test('10/50/100 LPCs across five blocks: visible-only sprites, identity on transition, F5 and frame samples',async({page})=>{
  const {WORLD}=await import('../../public/js/world.js');
  const blocks=Object.values(WORLD.blocks),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  let participants=[];
  await page.route('**/socket.io/socket.io.js',route=>route.fulfill({contentType:'text/javascript',body:'window.io=undefined;'}));
  await page.route('**/api/world',route=>route.fulfill({json:{participants,provisional:false}}));
  for(const count of [10,50,100]){
    participants=Array.from({length:count},(_,i)=>{
      const block=blocks[i%5],spawn=block.spawnPoints.center;
      return {id:`macro-person-${i}`,uuid:`macro-person-${i}`,name:`Visitante ${i}`,status:'ACTIVE',state:'VISITING',
        currentBlock:block.id,currentArea:'area_circulation',currentFloor:block.floor,currentRoom:'circulation',
        position:{x:spawn.x+(i%8)*.15,y:spawn.y+(i%3)*.2},
        avatarType:'lpc',avatarUrl:'/assets/avatars/lpc/test-avatar.png',avatarVersion:'test'};
    });
    await page.goto('/tela?block=blockB_upper');await ready(page);
    await expect.poll(async()=>(await sceneState(page)).people.length).toBe(count/5);
    expect((await sceneState(page)).latest).toBe(count);
    const metrics=await page.evaluate(async()=>{
      const times=[];await new Promise(resolve=>{function frame(t){times.push(t);if(times.length<90)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
      return {fps:Math.round((times.length-1)*1000/(times.at(-1)-times[0])),heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1024/1024):null};
    });
    console.log(JSON.stringify({total:count,visible:count/5,...metrics}));
    for(const block of blocks){
      await page.selectOption('#block-selector',block.id);
      await expect.poll(async()=>(await sceneState(page)).people.length).toBe(count/5);
      const state=await sceneState(page);
      expect(state.people.every(p=>p.block===block.id&&p.type==='lpc'&&p.scale===1.5&&p.label)).toBe(true);
    }
  }
  // Simulate an authoritative portal event, with the same identity and texture version.
  const moving=participants.find(p=>p.currentBlock==='blockA_upper');
  await page.selectOption('#block-selector','blockA_upper');
  await expect.poll(async()=>(await sceneState(page)).people.length).toBe(20);
  const before=(await sceneState(page)).people.find(p=>p.id===moving.id);
  const target=WORLD.blocks.blockB_upper,landing=target.navigationNodes.find(n=>n.id==='exit_to_blockA_upper');
  Object.assign(moving,{currentBlock:target.id,currentFloor:target.floor,position:{x:landing.x,y:landing.y}});
  await page.evaluate(async data=>{
    const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').participantsClient.applyEvent('moved',data);
  },moving);
  expect((await sceneState(page)).people.some(p=>p.id===moving.id)).toBe(false);
  await page.selectOption('#block-selector',target.id);
  await expect.poll(async()=>(await sceneState(page)).people.length).toBe(21);
  const after=(await sceneState(page)).people.find(p=>p.id===moving.id);
  expect(after.texture).toBe(before.texture);expect(after.name).toBe(before.name);
  await page.reload();await ready(page);
  await expect.poll(async()=>(await sceneState(page)).people.length).toBe(21);
  const restored=await sceneState(page);
  expect(restored.block).toBe('blockB_upper');expect(new Set(restored.people.map(p=>p.id)).size).toBe(21);
  expect(restored.people.find(p=>p.id===moving.id).texture).toBe(before.texture);
  await page.screenshot({path:'test-results/macro-100-lpc.png'});
  expect(errors).toEqual([]);
});
