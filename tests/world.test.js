const { test } = require('node:test');
const assert = require('node:assert/strict');
const {createApplication} = require('./helpers/authenticatedApplication');
const fs = require('node:fs');
const path = require('node:path');

test('raiz redireciona, tela e Phaser são servidos localmente', async () => {
  const testRoot=path.resolve('.test-data');fs.mkdirSync(testRoot,{recursive:true});
  const runtime=await createApplication({dataDir:fs.mkdtempSync(path.join(testRoot,'world-'))});
  const server=runtime.server.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const redirect = await fetch(base,{redirect:'manual'});
    assert.equal(redirect.status,302); assert.equal(redirect.headers.get('location'),'/tela');
    const page = await fetch(`${base}/tela`);
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html,/Sala 5/); assert.match(html,/Mundo \/\/ Digital/);
    const vendor = await fetch(`${base}/vendor/phaser.js`);
    assert.equal(vendor.status,200); assert.match(await vendor.text(),/Phaser/);
    const config=await fetch(`${base}/js/world-config.js`);
    assert.equal(config.status,200);
  } finally { await runtime.close(); }
});

test('a configuração legada da Sala 5 permanece intacta; conexões novas pertencem aos blocos', async () => {
  const {WORLD,groundFloor}=await import('../public/js/world.js');
  assert.deepEqual(Object.keys(groundFloor.rooms),['sala5_acesso']);
  assert.equal(groundFloor.rooms.sala5_acesso.type,'access_room');
  assert.equal(groundFloor.spawnPoints.sala5.id,'spawn_sala5');
  assert.equal(groundFloor.spawnPoints.sala5.roomId,'sala5_acesso');
  assert.equal(groundFloor.portals.sala5_corredor.id,'portal_sala5_corredor');
  assert.equal(groundFloor.portals.stairs_near_area34.id,'stairs_near_area34');
  assert.ok(Object.values(groundFloor.portals).every(portal=>!portal.enabled));
  assert.deepEqual(WORLD.floors.lower_floor.rooms,{});
  assert.equal(WORLD.floors.lower_floor.navigationNodes.length,0);
});

test('todos os waypoints são conectados e todas as rotas evitam móveis e paredes', async () => {
  const {WORLD,groundFloor,routeBetween,isPositionWalkable}=await import('../public/js/world.js');
  const nodes=groundFloor.navigationNodes;
  const sampleSegment=(from,to)=>{
    for(let i=0;i<=100;i++) {
      const point={x:from.x+(to.x-from.x)*i/100,y:from.y+(to.y-from.y)*i/100};
      assert.ok(isPositionWalkable(point),`Trajeto inválido em ${JSON.stringify(point)}`);
    }
  };
  for(const from of nodes) for(const to of nodes) {
    const route=routeBetween(from.id,to.id);
    assert.equal((route.at(-1)||from).id,to.id);
    let last=from;
    for(const next of route) {
      assert.ok(groundFloor.navigationEdges.some(([a,b])=>(a===last.id&&b===next.id)||(b===last.id&&a===next.id)));
      // The same offsets used by the eight participants must also be safe.
      for(let index=0;index<8;index++) {
        const offset={x:Math.cos(index*Math.PI/4)*WORLD.movement.laneRadius,y:Math.sin(index*Math.PI/4)*WORLD.movement.laneRadius};
        sampleSegment({x:last.x+offset.x,y:last.y+offset.y},{x:next.x+offset.x,y:next.y+offset.y});
      }
      last=next;
    }
  }
  const spawn=groundFloor.spawnPoints.sala5;
  spawn.offsets.forEach(([x,y],index)=>{
    sampleSegment({x:spawn.x+x,y:spawn.y+y},{x:spawn.x+Math.cos(index*Math.PI/4)*WORLD.movement.laneRadius,y:spawn.y+Math.sin(index*Math.PI/4)*WORLD.movement.laneRadius});
  });
  assert.throws(()=>routeBetween('inexistente','sala5_centro'),/desconhecido/);
  assert.equal(isPositionWalkable({x:1.9,y:10}),false); // The visible corridor is not playable.
  assert.equal(isPositionWalkable({x:1.5,y:1.7}),false); // Desk footprint.
  assert.equal(isPositionWalkable({x:5.9,y:2.9}),false); // Chair footprint.
});

