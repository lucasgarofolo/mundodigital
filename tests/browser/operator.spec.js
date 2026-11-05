const {test,expect}=require('../helpers/browserAuth');
const {createApplication}=require('../helpers/authenticatedApplication');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');

async function start(options={}){
  const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});
  const dataDir=options.dataDir||fs.mkdtempSync(path.join(root,'browser-operator-'));
  const runtime=await createApplication({dataDir,avatarProvider:'local',
    operatorKey:'',entryDelayMs:100,entrySpacingMs:0,passConfig:{accountId:'',apiToken:''},logger:()=>{},...options});
  runtime.server.listen(options.port||0);await new Promise(resolve=>runtime.server.once('listening',resolve));
  return {...runtime,dataDir,port:runtime.server.address().port,base:`http://localhost:${runtime.server.address().port}`};
}
async function seed(r,name,{block='blockC_lower',area='area_cnc',status='ACTIVE'}={}){
  const {createWalker}=await import('../../public/js/movement.js'),{WORLD}=await import('../../public/js/world.js');
  const b=WORLD.blocks[block],poi=b.pointsOfInterest.find(p=>p.areaId===area),node=b.navigationNodes.find(n=>n.id===poi.nodeId);
  const w=createWalker({id:randomUUID(),name,avatar:'/assets/avatars/lpc/test-avatar.png',avatarKind:'lpc',avatarType:'lpc',avatarVersion:'operator-test',
    currentBlock:block,currentArea:area,currentFloor:b.floor,currentRoom:area,currentNode:node.id,
    position:{x:node.x,y:node.y},experienceStatus:status,state:'VISITING',remaining:3600,hasLeftAccess:true,allowExploration:true},0);
  r.store.insert(w,`${w.id}@example.test`,Date.now());if(['ENTERING','ACTIVE'].includes(status))r.walkers.set(w.id,w);return w;
}
async function camera(page){
  return page.evaluate(async()=>{
    const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene'),c=s.cameraController;
    const p=s.characters.participantsById.get(c.focusedParticipantUuid);
    return {mode:c.cameraMode,uuid:c.focusedParticipantUuid,following:c.following,block:s.currentBlock,zoom:c.zoom,targetZoom:c.targetZoom,
      focus:{...c.focus},target:{...c.targetFocus},transition:!!c.transition,marker:c.focusMarker.visible,label:c.focusLabel.text,
      people:s.characters.participants.map(p=>p.id),type:p?.avatarType,scale:p?.avatar.scaleX,texture:p?.avatarSource,
      area:s.participantsClient?.latest.get(c.focusedParticipantUuid)?.currentArea,revision:c.revision};
  });
}
async function ready(tv){await tv.waitForFunction(async()=>{const {game}=await import('/js/game.js');return !!game.scene.getScene('WorldScene').cameraController;});}
const result=(page,w)=>page.locator(`li[data-uuid="${w.id}"]`);

test('operator → real Socket → TV: UUID focus, smooth camera, one minute permanence, movement, portals, entry, refresh, replacement and HOME',async({browser})=>{
  test.setTimeout(180000);
  const r=await start(),tv=await browser.newPage(),op=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  for(const page of [tv,op]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
  try{
    const lucas=await seed(r,'Lucas Garofolo'),duplicate=await seed(r,'Lucas Garofolo',{block:'blockB_lower',area:'area_metrologia'});
    const maria=await seed(r,'Maria Silva',{block:'blockA_upper',area:'area_robot_arm'});
    const joao=await seed(r,'João Souza',{block:'blockC_upper',area:'area_eletrica'});
    const waiting=await seed(r,'Maria Credencial',{status:'AVATAR_REVIEW'});
    await tv.goto(r.base+'/tela');await ready(tv);await op.goto(r.base+'/operator');
    await expect(op.locator('#connection-status')).toContainText('conectado');
    expect((await camera(tv)).mode).toBe('HOME');expect((await camera(tv)).block).toBe('blockB_upper');
    const {HOME_CAMERA}=await import('../../public/js/cameraConfig.js');
    await expect.poll(async()=>(await camera(tv)).focus.y).toBeCloseTo(HOME_CAMERA.center.y,2);
    await tv.screenshot({path:'test-results/operator-tv-home.png'});
    const input=op.locator('#participant-search');
    await input.fill('joao');await expect(result(op,joao)).toBeVisible();
    await input.fill('credencial');await expect(result(op,waiting).locator('button')).toBeDisabled();
    await expect(result(op,waiting)).toContainText('Ainda não entrou');
    await input.fill('LUC');await expect(op.locator('#search-results li')).toHaveCount(2);
    await expect(result(op,lucas)).toContainText('CNC');await expect(result(op,duplicate)).toContainText('Metrologia');
    await tv.evaluate(async()=>{
      const {game}=await import('/js/game.js');const s=game.scene.getScene('WorldScene');
      window.focusFrames=[];s.events.on('postupdate',()=>{const c=s.cameraController;if(c.transition)window.focusFrames.push({zoom:c.zoom,x:c.focus.x,y:c.focus.y});});
    });
    await result(op,lucas).locator('button').click();
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(lucas.id);
    await expect.poll(async()=>(await camera(tv)).block).toBe('blockC_lower');
    await expect.poll(async()=>(await camera(tv)).transition).toBe(false);
    const focused=await camera(tv);
    expect(focused).toMatchObject({mode:'FOCUS_PARTICIPANT',following:true,targetZoom:1.5,marker:true,label:'Lucas Garofolo',type:'lpc',scale:1.5});
    expect(focused.people.filter(id=>id===lucas.id)).toHaveLength(1);
    expect(await tv.evaluate(()=>window.focusFrames.length)).toBeGreaterThan(10);
    await expect(op.locator('#camera-title')).toHaveText('Lucas Garofolo');await expect(op.locator('#camera-location')).toContainText('CNC');
    await op.screenshot({path:'test-results/operator-mobile-focus.png'});await tv.screenshot({path:'test-results/operator-tv-focus.png'});
    await tv.mouse.move(950,500);await tv.mouse.wheel(0,-120);
    await expect.poll(async()=>(await camera(tv)).targetZoom).toBeCloseTo(1.6,3);
    await tv.keyboard.press('0');expect((await camera(tv)).uuid).toBe(lucas.id);
    await tv.setViewportSize({width:1280,height:720});await tv.waitForTimeout(250);
    expect((await camera(tv)).targetZoom).toBe(1.5);expect((await camera(tv)).following).toBe(true);
    await tv.setViewportSize({width:1920,height:1080});
    let elapsed=0;
    for(const second of [10,30,60]){
      await tv.waitForTimeout((second-elapsed)*1000);elapsed=second;
      expect((await camera(tv)).uuid).toBe(lucas.id);expect((await camera(tv)).following).toBe(true);
      console.log(`Operator permanence: ${second}s, same UUID, no automatic HOME`);
    }
    // Walk on real graph edges while the production timer broadcasts movement.
    const {planMacroRoute}=await import('../../public/js/macroNavigation.js');
    const {WORLD}=await import('../../public/js/world.js');
    const beforeMove=(await camera(tv)).focus;
    lucas.speed=8;planMacroRoute(lucas,'poi_area_fresadora');lucas.destination=WORLD.blocks.blockC_lower.pointsOfInterest.find(p=>p.areaId==='area_fresadora');
    await expect.poll(()=>lucas.currentArea,{timeout:10000}).toBe('area_fresadora');
    await expect(op.locator('#camera-location')).toContainText('Fresadora');
    expect(Math.hypot((await camera(tv)).focus.x-beforeMove.x,(await camera(tv)).focus.y-beforeMove.y)).toBeGreaterThan(20);
    const portal=WORLD.blocks.blockC_lower.portals[0];planMacroRoute(lucas,portal.nodeId);lucas.destination=portal;
    await expect.poll(async()=>(await camera(tv)).block,{timeout:10000}).toBe('blockC_upper');
    await expect.poll(async()=>(await camera(tv)).people.includes(lucas.id)).toBe(true);
    expect((await camera(tv)).uuid).toBe(lucas.id);expect((await camera(tv)).texture).toBe(focused.texture);
    expect((await camera(tv)).people.filter(id=>id===lucas.id)).toHaveLength(1);
    lucas.state='VISITING';lucas.route=[];lucas.remaining=3600;
    await expect(op.locator('#camera-location')).toContainText('Bloco C · Superior');
    await tv.reload();await ready(tv);
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(lucas.id);
    await expect.poll(async()=>(await camera(tv)).marker).toBe(true);
    expect((await camera(tv)).block).toBe('blockC_upper');
    // A real synthetic check-in/approval/door entry must not take over the camera.
    const photo=await sharp({create:{width:64,height:64,channels:3,background:'#9ebfc6'}}).png().toBuffer();
    const body=new FormData();body.set('selfieAiAcknowledged','true');body.set('name','Nova Entrada');body.set('email',`${randomUUID()}@example.test`);
    body.set('selfie',new Blob([photo],{type:'image/png'}),'synthetic.png');
    const session=await (await fetch(r.base+'/api/check-in',{method:'POST',body})).json();
    await fetch(`${r.base}/api/participants/${session.participant.uuid}/approve-avatar`,{method:'POST',headers:{Authorization:`Bearer ${session.reviewToken}`}});
    await expect.poll(()=>r.walkers.get(session.participant.uuid)?.experienceStatus).toBe('ACTIVE');
    expect((await camera(tv)).uuid).toBe(lucas.id);expect((await camera(tv)).block).toBe('blockC_upper');
    expect(r.walkers.get(session.participant.uuid).avatarType).toBe('lpc');
    await input.fill('Maria Silva');await expect(result(op,maria)).toBeVisible();
    await result(op,maria).locator('button').click();
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(maria.id);
    await expect.poll(async()=>(await camera(tv)).block).toBe('blockA_upper');
    await expect.poll(async()=>(await camera(tv)).marker).toBe(true);
    await expect(op.locator('#camera-title')).toHaveText('Maria Silva');
    // Disappearance freezes the current view; it never sends HOME.
    await expect.poll(async()=>(await camera(tv)).transition).toBe(false);
    r.store.db.prepare("UPDATE participants SET status='INACTIVE' WHERE uuid=?").run(maria.id);r.walkers.delete(maria.id);r.operatorControl.refresh();
    await expect(op.locator('#camera-status')).toHaveText('Participante não está mais disponível no mundo.');
    await expect.poll(async()=>(await camera(tv)).following).toBe(false);
    const frozen=(await camera(tv)).focus;
    await tv.evaluate(async()=>{const {game}=await import('/js/game.js');await game.scene.getScene('WorldScene').participantsClient.synchronize();});
    await tv.waitForTimeout(1200);
    expect((await camera(tv)).focus).toEqual(frozen);expect((await camera(tv)).block).toBe('blockA_upper');
    expect((await camera(tv)).mode).toBe('FOCUS_PARTICIPANT');expect((await camera(tv)).uuid).toBe(maria.id);
    const lucasBlock=lucas.currentBlock,duplicatePosition={...duplicate.position};
    await op.locator('#camera-home').click();
    await expect.poll(async()=>(await camera(tv)).mode).toBe('HOME');
    await expect.poll(async()=>(await camera(tv)).transition).toBe(false);
    const home=await camera(tv);expect(home.uuid).toBe(null);expect(home.block).toBe('blockB_upper');expect(home.zoom).toBe(1);
    expect(home.focus).toEqual(HOME_CAMERA.center);expect(lucas.currentBlock).toBe(lucasBlock);expect(duplicate.position).toEqual(duplicatePosition);
    await expect(op.locator('#camera-title')).toHaveText('Sala de Acesso');
    expect(errors).toEqual([]);
  }finally{await tv.close();await op.close();await r.close();}
});

test('session authentication, read-only TV sockets, debounced bounded search and debug status',async({browser})=>{
  const r=await start({operatorKey:'browser-operator-test'}),context=await browser.newContext({viewport:{width:1280,height:720}}),op=await context.newPage(),tv=await browser.newPage();
  const errors=[];op.on('pageerror',e=>errors.push(e.message));tv.on('pageerror',e=>errors.push(e.message));
  try{
    const participant=await seed(r,'João Operador');
    for(let i=0;i<35;i++)await seed(r,`João Operador ${i}`);
    await op.goto(r.base+'/operator');await expect(op.locator('#operator-controls')).toBeVisible();await expect(op.locator('#connection-status')).toContainText('conectado');
    const cookies=await context.cookies();expect(cookies.find(c=>c.name==='world_session').httpOnly).toBe(true);
    let searches=0;op.on('request',request=>{if(request.url().includes('/api/participants/search?'))searches++;});
    await op.locator('#participant-search').pressSequentially('joao',{delay:40});
    await expect(op.locator('#search-results li')).toHaveCount(20);expect(searches).toBe(1);
    await expect(op.locator('#search-status')).toContainText('refine');
    await op.setViewportSize({width:390,height:844});
    await expect(op.locator('#camera-home')).toBeInViewport();
    await expect(op.locator('#camera-title')).toBeInViewport();
    await tv.goto(r.base+'/tela?debugWorld=true');await ready(tv);
    const blocked=await tv.evaluate(async uuid=>{
      const {game}=await import('/js/game.js'),s=game.scene.getScene('WorldScene');
      return new Promise(resolve=>s.participantsClient.socket.timeout(400).emit('camera:focusParticipant',{participantUuid:uuid},err=>resolve(!!err)));
    },participant.id);
    expect(blocked).toBe(true);expect(r.operatorControl.state().cameraMode).toBe('HOME');
    const lastResult=op.locator('#search-results li').last(),lastUuid=await lastResult.getAttribute('data-uuid');
    await lastResult.locator('button').click();
    await expect.poll(()=>r.operatorControl.state().focusedParticipantUuid).toBe(lastUuid);
    await result(op,participant).locator('button').click();
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(participant.id);
    await expect(tv.locator('#camera-debug')).toContainText('FOCUS_PARTICIPANT');
    await expect(tv.locator('#camera-debug')).toContainText(participant.id);
    expect(await op.locator('body').innerText()).not.toContain('@example.test');
    expect(await op.locator('body').innerText()).not.toContain('browser-operator-test');
    await op.screenshot({path:'test-results/operator-mobile-docked.png'});
    await op.setViewportSize({width:1280,height:720});await op.screenshot({path:'test-results/operator-desktop.png'});
    expect(errors).toEqual([]);
  }finally{await context.close();await tv.close();await r.close();}
});

test('server restart replaces operational camera epoch: connected TV/operator return HOME while the participant stays in its block',async({browser})=>{
  let r=await start();const tv=await browser.newPage(),op=await browser.newPage();
  try{
    const w=await seed(r,'Lucas Restart');r.operatorControl.focus(w.id);
    await tv.goto(r.base+'/tela');await ready(tv);await op.goto(r.base+'/operator');
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(w.id);
    await expect(op.locator('#camera-title')).toHaveText('Lucas Restart');
    const instance=r.operatorControl.state().instanceId,dataDir=r.dataDir,port=r.port;
    await r.close();r=await start({dataDir,port});
    expect(r.operatorControl.state().instanceId).not.toBe(instance);
    await expect.poll(async()=>(await camera(tv)).mode,{timeout:15000}).toBe('HOME');
    await expect.poll(async()=>(await camera(tv)).block).toBe('blockB_upper');
    await expect(op.locator('#camera-title')).toHaveText('Sala de Acesso');
    expect(r.walkers.get(w.id).currentBlock).toBe('blockC_lower');
    expect((await camera(tv)).uuid).toBe(null);
  }finally{await tv.close();await op.close();await r.close();}
});

test('inline world controls find by UUID, collapse without losing focus, synchronize with remote operator and keep HOME visible after refresh/resize',async({browser})=>{
  const r=await start(),tv=await browser.newPage(),op=await browser.newPage(),errors=[];
  for(const page of [tv,op]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
  try{
    const lucas=await seed(r,'Lucas Silva'),duplicate=await seed(r,'Lucas Silva',{block:'blockB_lower',area:'area_metrologia'});
    const maria=await seed(r,'Maria Silva',{block:'blockA_upper',area:'area_robot_arm'});
    await tv.goto(r.base+'/tela');await ready(tv);
    const input=tv.locator('#participant-search'),toggle=tv.locator('#toggle-world-controls'),home=tv.locator('#camera-home');
    await expect(input).toBeVisible();await expect(home).toBeEnabled();
    const hud=await tv.locator('.hud').boundingBox(),initialZoom=(await camera(tv)).zoom;
    await input.pressSequentially('luc0+-');
    expect((await camera(tv)).zoom).toBe(initialZoom);
    await input.fill('luc');await expect(tv.locator('#search-results li')).toHaveCount(2);
    await expect(result(tv,lucas)).toContainText('CNC');await expect(result(tv,duplicate)).toContainText('Metrologia');
    await tv.screenshot({path:'test-results/world-controls-search.png'});
    await result(tv,lucas).locator('button').click();
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(lucas.id);
    await expect.poll(async()=>(await camera(tv)).marker).toBe(true);
    await expect(tv.locator('#search-results')).toBeHidden();
    expect(await tv.locator('.hud').boundingBox()).toEqual(hud);
    await input.focus();await expect(tv.locator('#search-results')).toBeVisible();
    await input.press('Escape');await expect(tv.locator('#search-results')).toBeHidden();
    const commandId=r.operatorControl.state().commandId;
    await toggle.click();await expect(input).toBeHidden();await expect(home).toBeInViewport();
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await tv.waitForTimeout(1500);
    expect((await camera(tv)).following).toBe(true);expect((await camera(tv)).uuid).toBe(lucas.id);
    expect(r.operatorControl.state().commandId).toBe(commandId);
    await tv.screenshot({path:'test-results/world-controls-collapsed.png'});
    await op.goto(r.base+'/operator');await expect(op.locator('#connection-status')).toContainText('conectado');
    await op.locator('#participant-search').fill('Maria');await expect(result(op,maria)).toBeVisible();
    await result(op,maria).locator('button').click();
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(maria.id);
    await expect(tv.locator('#camera-title')).toHaveText('Maria Silva');
    await expect(input).toBeHidden();
    await tv.reload();await ready(tv);
    await expect.poll(async()=>(await camera(tv)).uuid).toBe(maria.id);
    await expect(toggle).toHaveText('Mostrar controles');await expect(home).toBeEnabled();
    await tv.setViewportSize({width:390,height:844});await expect(home).toBeInViewport();
    const before=[lucas,duplicate,maria].map(w=>({id:w.id,block:w.currentBlock,position:{...w.position}}));
    await home.click();
    await expect.poll(async()=>(await camera(tv)).mode).toBe('HOME');
    await expect.poll(async()=>(await camera(tv)).transition).toBe(false);
    expect((await camera(tv)).block).toBe('blockB_upper');expect((await camera(tv)).uuid).toBe(null);
    const {HOME_CAMERA}=await import('../../public/js/cameraConfig.js');
    expect((await camera(tv)).focus).toEqual(HOME_CAMERA.center);
    expect(await tv.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').cameraController.bounds;})).toEqual(HOME_CAMERA.bounds);
    expect([lucas,duplicate,maria].map(w=>({id:w.id,block:w.currentBlock,position:{...w.position}}))).toEqual(before);
    await expect(op.locator('#camera-title')).toHaveText('Sala de Acesso');
    await toggle.click();await expect(input).toBeVisible();
    await tv.screenshot({path:'test-results/world-controls-mobile.png'});
    expect(errors).toEqual([]);
  }finally{await tv.close();await op.close();await r.close();}
});

test('inline world controls use the admin session and scroll results without zooming the world',async({browser})=>{
  const r=await start({operatorKey:'inline-test-key'}),tv=await browser.newPage(),errors=[];
  tv.on('pageerror',e=>errors.push(e.message));
  try{
    for(let i=0;i<25;i++)await seed(r,`Visitante ${i}`);
    await tv.goto(r.base+'/tela');await ready(tv);
    await expect(tv.locator('#participant-search')).toBeVisible();await expect(tv.locator('#camera-home')).toBeEnabled();
    await tv.locator('#participant-search').fill('visitante');await expect(tv.locator('#search-results li')).toHaveCount(20);
    const zoom=(await camera(tv)).targetZoom,box=await tv.locator('#search-results').boundingBox();
    await tv.mouse.move(box.x+box.width/2,box.y+box.height/2);await tv.mouse.wheel(0,500);await tv.waitForTimeout(250);
    expect((await camera(tv)).targetZoom).toBe(zoom);
    expect(await tv.locator('#search-results').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    await tv.locator('#toggle-world-controls').click();await expect(tv.locator('#camera-home')).toBeInViewport();
    expect(errors).toEqual([]);
  }finally{await tv.close();await r.close();}
});
