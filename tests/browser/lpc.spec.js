const {test,expect}=require('../helpers/browserAuth');

test('one LPC among seven placeholders: directions, idle, depth, zoom and stable resources',async({page})=>{
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(r.url().includes('/assets/avatars/lpc/'))requests.push(r.url());});
  await page.goto('/tela?lpcTest=true');
  await page.waitForFunction(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.length===8;});
  const snapshot=()=>page.evaluate(async()=>{
    const {game}=await import('/js/game.js'),{project,isPositionWalkable}=await import('/js/world.js');
    const s=game.scene.getScene('WorldScene'),p=s.characters.participantsById.get('lpc_test_avatar');
    return {count:s.characters.participants.length,old:s.characters.participants.filter(p=>p.avatar.type==='Image').length,
      type:p.avatar.type,frames:s.textures.get('lpc-test-avatar').frameTotal,
      anims:Object.keys(s.anims.anims.entries).filter(k=>k.startsWith('lpc-test-avatar-')).length,
      scale:p.avatar.scaleX,flip:p.avatar.flipX,position:{...p.position},state:p.state,visits:p.visits,
      follows:p.visual.x===project(p.x,p.y).x&&p.visual.y===project(p.x,p.y).y,
      depth:p.visual.depth,expectedDepth:project(p.x,p.y).y,valid:isPositionWalkable(p.position),
      label:p.visual.list[2].text,shadow:p.visual.list[0].type,pixelArt:s.game.config.pixelArt};
  });
  const initial=await snapshot();
  expect(initial).toMatchObject({count:8,old:7,type:'Sprite',frames:37,anims:4,scale:1.5,flip:false,follows:true,valid:true,label:'LPC',shadow:'Ellipse',pixelArt:true});

  // Drive short screen-space displacements through the existing CharacterManager.
  // Authoritative interpolation is already used by real participants; no routes are changed.
  await page.evaluate(async()=>{const {game}=await import('/js/game.js');const p=game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar');p.testSaved={position:{...p.position},state:p.state};p.authoritative=true;});
  for(const [direction,dx,dy,idle] of [['up',-.1,-.1,0],['left',-.1,.1,9],['down',.1,.1,18],['right',.1,-.1,27]]) {
    await page.evaluate(async({dx,dy})=>{const {game}=await import('/js/game.js');const p=game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar');p.state='WALKING';p.targetPosition={x:p.x+dx,y:p.y+dy};},{dx,dy});
    await expect.poll(()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar').avatar.anims.currentAnim?.key;})).toBe(`lpc-test-avatar-walk-${direction}`);
    await page.waitForTimeout(130);
    const walking=await page.evaluate(async()=>{const {game}=await import('/js/game.js');const a=game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar').avatar;return {frame:a.frame.name,playing:a.anims.isPlaying};});
    expect(walking.playing).toBe(true);expect(walking.frame).toBeGreaterThan(idle+1);expect(walking.frame).toBeLessThanOrEqual(idle+8);
    await page.evaluate(async()=>{const {game}=await import('/js/game.js');const p=game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar');p.state='VISITING';delete p.targetPosition;});
    await expect.poll(()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters.participantsById.get('lpc_test_avatar').avatar.frame.name;})).toBe(idle);
  }
  // Verify display-list sorting against actual furniture at both sides of its depth.
  const depth=await page.evaluate(async()=>{
    const {game}=await import('/js/game.js'),{project,groundFloor,WORLD}=await import('/js/world.js');
    const s=game.scene.getScene('WorldScene'),p=s.characters.participantsById.get('lpc_test_avatar'),f=groundFloor.rooms[WORLD.activeRoom].furniture[0];
    const threshold=project(f.x+f.width,f.y+f.height).y;
    const object=s.children.list.find(o=>o.type==='Graphics'&&o.depth===threshold);
    const results=[];
    for(const y of [f.y-.5,f.y+f.height+.5]){
      p.position={x:f.x+f.width,y};s.characters.syncVisual(p);s.children.depthSort();
      results.push({before:s.children.list.indexOf(p.visual)<s.children.list.indexOf(object),depth:p.visual.depth,threshold});
    }
    p.position=p.testSaved.position;p.state=p.testSaved.state;p.authoritative=false;delete p.testSaved;s.characters.syncVisual(p);
    return results;
  });
  expect(depth[0].before).toBe(true);expect(depth[1].before).toBe(false);
  const hud=await page.locator('.hud').boundingBox();
  await page.keyboard.press('+');await page.waitForTimeout(900);
  expect(await page.locator('.hud').boundingBox()).toEqual(hud);
  await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(400);
  await page.keyboard.press('0');await page.waitForTimeout(900);
  await expect.poll(async()=>{const s=await snapshot();return Math.hypot(s.position.x-initial.position.x,s.position.y-initial.position.y);},{timeout:15000}).toBeGreaterThan(.2);
  await page.waitForTimeout(12000);
  const final=await snapshot();expect(final.valid&&final.follows).toBe(true);
  expect(final.depth).toBe(final.expectedDepth);expect(final.anims).toBe(4);expect(final.frames).toBe(37);
  await page.screenshot({path:'test-results/lpc-sala5.png'});
  expect(requests).toHaveLength(1);expect(errors).toEqual([]);
  await page.goto('/tela?demo=1');
  await expect.poll(()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.filter(p=>p.avatar.type==='Image').length;})).toBe(8);
});
