const {test,expect}=require('../helpers/browserAuth');

test('zoom suave, atalhos, limites, foco, HUD fixo e resize',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto('/tela?demo=1');
  await page.waitForFunction(async()=>{const {game}=await import('/js/game.js');return !!game.scene.getScene('WorldScene').cameraController;});
  const snapshot=()=>page.evaluate(async()=>{
    const {game}=await import('/js/game.js');
    const {project,isPositionWalkable}=await import('/js/world.js');
    const scene=game.scene.getScene('WorldScene'),c=scene.cameraController;
    return {zoom:c.zoom,target:c.targetZoom,actual:c.camera.zoom,base:c.baseZoom,
      center:{x:c.camera.midPoint.x,y:c.camera.midPoint.y},focus:{...c.focus},defaultFocus:c.defaultFocus,
      people:scene.characters.participants.map(p=>({x:p.x,y:p.y,visits:p.visits,
        valid:isPositionWalkable(p.position),follows:Math.abs(p.visual.x-project(p.x,p.y).x)<.01&&Math.abs(p.visual.y-project(p.x,p.y).y)<.01})),
    };
  });
  const settled=async()=>{
    await expect.poll(async()=>{const s=await snapshot();return Math.abs(s.zoom-s.target);}).toBeLessThan(.0001);
    return snapshot();
  };
  const initial=await snapshot();
  const hud=await page.locator('.hud').boundingBox();
  expect(initial.zoom).toBe(1);
  await page.mouse.move(960,540);
  await page.mouse.wheel(0,-120);
  const inView=await settled();expect(inView.zoom).toBeCloseTo(1.1,4);
  await page.mouse.wheel(0,120);
  expect((await settled()).zoom).toBeCloseTo(1,4);

  // Record frame samples to prove the actual camera transitions, rather than jumps.
  await page.evaluate(async()=>{
    const {game}=await import('/js/game.js');const scene=game.scene.getScene('WorldScene');
    scene.cameraSamples=[];scene.events.on('postupdate',()=>scene.cameraSamples.push(scene.cameraController.zoom));
  });
  await page.keyboard.press('+');
  expect((await settled()).zoom).toBeCloseTo(1.1,4);
  const samples=await page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').cameraSamples;});
  expect(samples.filter(z=>z>1.001&&z<1.099).length).toBeGreaterThan(3);
  for(let i=1;i<samples.length;i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i-1]);
  await page.keyboard.press('-');expect((await settled()).zoom).toBeCloseTo(1,4);
  await page.keyboard.press('NumpadAdd');expect((await settled()).zoom).toBeCloseTo(1.1,4);
  await page.keyboard.press('NumpadSubtract');expect((await settled()).zoom).toBeCloseTo(1,4);
  for(let i=0;i<24;i++) await page.keyboard.press('+');
  const max=await settled();expect(max.zoom).toBe(1.8);
  expect(await page.locator('.hud').boundingBox()).toEqual(hud);
  expect(max.center.x).toBeCloseTo(initial.center.x,1);expect(max.center.y).toBeCloseTo(initial.center.y,1);
  await page.screenshot({path:'test-results/sala5-zoom-max.png'});
  for(let i=0;i<30;i++) await page.keyboard.press('-');
  expect((await settled()).zoom).toBe(.65);
  await page.mouse.wheel(0,500);expect((await settled()).zoom).toBe(.65);
  await page.keyboard.press('0');expect((await settled()).zoom).toBe(1);
  for(let i=0;i<4;i++) await page.keyboard.press('+');
  await settled();
  for(const [width,height] of [[1280,720],[390,844],[1920,1080]]) {
    await page.setViewportSize({width,height});await page.waitForTimeout(400);
    const s=await settled();
    expect(s.zoom).toBeCloseTo(1.4,4);
    expect(s.actual).toBeCloseTo(s.base*s.zoom,4);
    expect(s.center.x).toBeCloseTo(initial.center.x,1);expect(s.center.y).toBeCloseTo(initial.center.y,1);
  }
  // Resize during interpolation must retain the requested destination as well.
  await page.keyboard.press('+');await page.setViewportSize({width:1280,height:720});
  expect((await settled()).zoom).toBeCloseTo(1.5,4);
  await page.keyboard.press('0');
  const reset=await settled();expect(reset.zoom).toBe(1);
  expect(reset.actual).toBeCloseTo(reset.base,4);
  await page.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').cameraController.focusOn(6,5,{zoom:1.2});});
  await page.waitForTimeout(1500);
  const focus=await settled();expect(focus.focus.x).toBeCloseTo(32,1);expect(focus.focus.y).toBeCloseTo(176,1);
  // Phaser rounds camera scroll for pixel art. At responsive fractional zoom,
  // the rendered midpoint can differ by up to one screen pixel from the focus.
  expect(Math.abs(focus.center.x-32)*focus.actual).toBeLessThanOrEqual(1.01);
  expect(Math.abs(focus.center.y-176)*focus.actual).toBeLessThanOrEqual(1.01);
  await page.keyboard.press('0');await page.waitForTimeout(1500);
  const restored=await settled();expect(restored.center.x).toBeCloseTo(initial.center.x,1);expect(restored.center.y).toBeCloseTo(initial.center.y,1);
  expect(restored.people).toHaveLength(8);
  expect(restored.people.every(p=>p.valid&&p.follows)).toBe(true);
  expect(restored.people.some((p,i)=>Math.hypot(p.x-initial.people[i].x,p.y-initial.people[i].y)>.1)).toBe(true);
  expect(errors).toEqual([]);
});

