const {test,expect}=require('../helpers/browserAuth');
const {fork}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {seedParticipants}=require('../../scripts/load-test');

async function start(dataDir,port=0) {
  const child=fork(path.resolve('tests/fixtures/server-process.cjs'),[dataDir,String(port)],
    {windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,AVATAR_PROVIDER:'local'}});
  let errors='';child.stderr.on('data',data=>{errors+=data;});
  const actualPort=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error(`Servidor não iniciou: ${errors}`));},15000);
    child.once('message',message=>{clearTimeout(timeout);resolve(message.port);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Servidor encerrou (${code}): ${errors}`));});
  });
  return {child,port:actualPort,base:`http://127.0.0.1:${actualPort}`};
}
async function stop(runtime) {
  if(runtime.child.exitCode!==null)return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{runtime.child.kill();reject(new Error('Servidor não encerrou.'));},15000);
    runtime.child.once('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(`Encerramento ${code}`));});
    runtime.child.send('shutdown');
  });
}
const count=page=>page.evaluate(async()=>{
  const {game}=await import('/js/game.js');const scene=game.scene.getScene('WorldScene');
  return {sprites:scene.characters.participants.length,ids:scene.characters.participantsById.size,
    unique:new Set(scene.characters.participants.map(p=>p.id)).size};
});

test('restauração por API sem Socket, F5 com 3, restart real do Node, reconexão e carga de 10/50 no Phaser',async({browser})=>{
  const root=path.resolve('.test-data');fs.mkdirSync(root,{recursive:true});
  const dataDir=fs.mkdtempSync(path.join(root,'browser-persistence-'));
  let runtime=await start(dataDir);const page=await browser.newPage(),second=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));second.on('pageerror',error=>errors.push(error.message));
  try {
    const {participants}=await seedParticipants(runtime.base,3);
    await page.goto(`${runtime.base}/tela`);
    await expect.poll(()=>count(page)).toEqual({sprites:3,ids:3,unique:3});
    let apiCalls=0;page.on('request',request=>{if(request.url().endsWith('/api/world'))apiCalls++;});
    await page.reload();await expect.poll(()=>count(page)).toEqual({sprites:3,ids:3,unique:3});expect(apiCalls).toBeGreaterThan(0);
    const port=runtime.port;await stop(runtime);runtime=await start(dataDir,port);
    await expect.poll(()=>count(page)).toEqual({sprites:3,ids:3,unique:3});
    await expect(page.locator('#world-status')).toContainText('AO VIVO',{timeout:15000});
    await page.reload();await expect.poll(()=>count(page)).toEqual({sprites:3,ids:3,unique:3});
    const world=await (await fetch(`${runtime.base}/api/world`)).json();
    expect(world.participants.map(p=>p.uuid).sort()).toEqual(participants.map(p=>p.uuid).sort());
    await second.goto(`${runtime.base}/tela`);await expect.poll(()=>count(second)).toEqual({sprites:3,ids:3,unique:3});
    await page.evaluate(async()=>{
      const {game}=await import('/js/game.js');const client=game.scene.getScene('WorldScene').participantsClient;
      window.fullSnapshots=0;window.movementEvents=0;
      client.socket.on('participants:sync',()=>window.fullSnapshots++);
      client.socket.on('participants:moved',()=>window.movementEvents++);
    });
    await seedParticipants(runtime.base,7);
    for(const display of [page,second])await expect.poll(()=>count(display)).toEqual({sprites:10,ids:10,unique:10});
    await seedParticipants(runtime.base,40);
    for(const display of [page,second])await expect.poll(()=>count(display),{timeout:20000}).toEqual({sprites:50,ids:50,unique:50});
    await page.waitForTimeout(6000);
    expect(await page.evaluate(()=>window.fullSnapshots)).toBe(0);expect(await page.evaluate(()=>window.movementEvents)).toBeGreaterThan(0);
    await page.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').participantsClient.socket.disconnect();});
    await seedParticipants(runtime.base,1);
    await page.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').participantsClient.socket.connect();});
    await expect.poll(()=>count(page),{timeout:15000}).toEqual({sprites:51,ids:51,unique:51});
    const offline=await browser.newPage();offline.on('pageerror',error=>errors.push(error.message));
    await offline.route('**/socket.io/**',route=>route.abort());
    await offline.goto(`${runtime.base}/tela`);
    await expect.poll(()=>count(offline),{timeout:15000}).toEqual({sprites:51,ids:51,unique:51});
    await offline.close();
    expect((await (await fetch(`${runtime.base}/api/health`)).json()).activeParticipants).toBe(51);
    await page.screenshot({path:'test-results/sala5-persistence-51.png'});
    expect(errors).toEqual([]);
  } finally {await page.close();await second.close();await stop(runtime);}
});
