const { test, expect } = require('../helpers/browserAuth');

test('Sala 5: spawn, circulação segura, resize e dois minutos de estabilidade', async ({ page }) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  page.on('console', message=>{if(message.type()==='error') errors.push(message.text());});
  await page.goto('/tela?demo=1');
  await page.waitForFunction(async()=>{
    const {game}=await import('/js/game.js');
    return game.scene.getScene('WorldScene').characters?.participants.length===8;
  });
  await page.evaluate(async()=>{
    const {game}=await import('/js/game.js');
    const {isPositionWalkable}=await import('/js/world.js');
    const scene=game.scene.getScene('WorldScene');
    scene.scene.pause();
    scene.testObservations={violations:[],destinations:new Set()};
    scene.events.on('postupdate',()=>{
      for(const p of scene.characters.participants) {
        if(!isPositionWalkable(p.position)||p.currentRoom!=='sala5_acesso'||p.currentFloor!=='ground_floor') {
          scene.testObservations.violations.push({id:p.id,x:p.x,y:p.y});
        }
        if(p.state==='VISITING') scene.testObservations.destinations.add(p.destination.id);
      }
    });
  });
  const snapshot = ()=>page.evaluate(async()=>{
    const {game}=await import('/js/game.js');
    const scene=game.scene.getScene('WorldScene');
    const {WORLD,groundFloor,project,isPositionWalkable}=await import('/js/world.js');
    const camera=scene.cameras.main;
    return {
      canvas:{width:game.canvas.width,height:game.canvas.height},
      fits:camera.worldView.contains(WORLD.bounds.x,WORLD.bounds.y)&&camera.worldView.contains(WORLD.bounds.x+WORLD.bounds.width,WORLD.bounds.y+WORLD.bounds.height),
      rooms:Object.keys(groundFloor.rooms),lowerRooms:Object.keys(WORLD.floors.lower_floor.rooms),spawnArea:groundFloor.spawnPoints.sala5.area,
      violations:scene.testObservations.violations,destinations:[...scene.testObservations.destinations],
      people:scene.characters.participants.map(p=>({
        id:p.id,name:p.name,x:p.x,y:p.y,position:{...p.position},currentFloor:p.currentFloor,currentRoom:p.currentRoom,
        state:p.state,visits:p.visits,spawnPointId:p.spawnPointId,walkable:isPositionWalkable(p.position),
        label:p.visual.list[2].text,
        follows:Math.abs(p.visual.x-project(p.x,p.y).x)<.01&&Math.abs(p.visual.y-project(p.x,p.y).y)<.01,
      })),
    };
  });
  const initial=await snapshot();
  expect(initial.people).toHaveLength(8);
  expect(initial.rooms).toEqual(['sala5_acesso']); expect(initial.lowerRooms).toEqual([]);
  const area=initial.spawnArea;
  expect(initial.people.every(p=>p.spawnPointId==='spawn_sala5'&&p.currentRoom==='sala5_acesso'&&p.currentFloor==='ground_floor'&&p.x>=area.x&&p.x<=area.x+area.width&&p.y>=area.y&&p.y<=area.y+area.height)).toBe(true);
  expect(new Set(initial.people.map(p=>`${p.x},${p.y}`)).size).toBe(8);
  await expect(page.locator('#participant-count')).toHaveText('Participantes: 8');
  await expect(page.locator('.room-label')).toHaveText('Sala 5');
  await expect(page.locator('.identity .brand')).toHaveText('Mundo //');
  await expect(page.locator('.subtitle')).toHaveText('Digital');
  await page.screenshot({path:'test-results/sala5-spawn-1920.png'});
  await page.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.resume('WorldScene');});
  for (const [width,height] of [[1920,1080],[1280,720],[800,600],[390,844]]) {
    await page.setViewportSize({width,height});await page.waitForTimeout(350);
    const current=await snapshot();
    expect(current.canvas).toEqual({width,height}); expect(current.fits).toBe(true);
    expect(current.people.every(p=>p.label&&p.follows&&p.walkable)).toBe(true);
    if(width===390) await page.screenshot({path:'test-results/sala5-mobile.png'});
  }
  await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(7000);
  const moving=await snapshot();
  expect(moving.people.some((p,i)=>Math.hypot(p.x-initial.people[i].x,p.y-initial.people[i].y)>.1)).toBe(true);
  await page.screenshot({path:'test-results/sala5-1920.png'});
  for(let i=0;i<4;i++) {
    await page.waitForTimeout(30000);
    const current=await snapshot();
    expect(current.people).toHaveLength(8);
    expect(current.people.every(p=>p.walkable&&p.follows&&p.x===p.position.x&&p.y===p.position.y)).toBe(true);
    expect(current.violations).toEqual([]);
    console.log(`Estabilidade Sala 5: ${(i+1)*30}s; visitas: ${current.people.reduce((n,p)=>n+p.visits,0)}`);
  }
  const final=await snapshot();
  expect(final.people.every(p=>p.visits>0)).toBe(true);
  expect(final.destinations.length).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

