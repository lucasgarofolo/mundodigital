const {test,expect}=require('../helpers/browserAuth');
const sharp=require('sharp');

test('check-in mobile, entrada em dois telões, reconexão, reload e deduplicação',async({browser,page,request})=>{
  const errors=[];
  const displayA=await browser.newPage(),displayB=await browser.newPage();
  for(const display of [displayA,displayB]) {
    display.on('pageerror',e=>errors.push(e.message));
    display.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await display.goto('/tela');
    await display.waitForFunction(async()=>{const {game}=await import('/js/game.js');return !!game.scene.getScene('WorldScene').participantsClient?.socket.connected;});
    await expect(display.locator('#world-status')).toContainText('AVATARES PROVISÓRIOS');
  }
  const initial=await request.get('/api/participants');const initialCount=(await initial.json()).participants.length;
  await page.setViewportSize({width:390,height:844});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/check-in');
  await expect(page.locator('#provider-note')).toContainText('crachá');
  await page.locator('#name').fill('Visitante Mobile');
  const email=`mobile-${Date.now()}@example.test`;
  await page.locator('#email').fill(email);
  await expect(page.locator('#submit')).toBeDisabled();await page.locator('#selfie-ai-acknowledged').check();
  await page.locator('#submit').click();await expect(page.locator('#error')).toContainText('selfie');
  const photo=await sharp({create:{width:64,height:64,channels:3,background:'#9ebfc6'}}).png().toBuffer();
  await page.locator('#selfie-ai-acknowledged').check();await page.locator('#photo').setInputFiles({name:'selfie.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('#preview')).toBeVisible();
  await page.screenshot({path:'test-results/check-in-mobile.png',fullPage:true});
  const responsePromise=await require('../helpers/captureCheckin')(page);
  await page.locator('#submit').click();
  const response=await responsePromise.result;expect(response.status).toBe(201);
  const result=response.body,id=result.participant.id;
  expect(result.participant.status).toBe('AVATAR_REVIEW');
  for(const display of [displayA,displayB])await expect(display.locator('#participant-count')).toHaveText('Participantes: '+initialCount);
  await page.waitForURL(/\/pass\//);await expect(page.locator('#enter-world')).toBeEnabled();await page.locator('#enter-world').click();
  expect(JSON.stringify(result)).not.toContain(email);
  const snapshot=display=>display.evaluate(async()=>{
    const {game}=await import('/js/game.js');const scene=game.scene.getScene('WorldScene');
    const {project}=await import('/js/world.js');
    return scene.characters.participants.map(p=>({id:p.id,name:p.name,state:p.state,x:p.x,y:p.y,
      follows:Math.abs(p.visual.x-project(p.x,p.y).x)<.01&&Math.abs(p.visual.y-project(p.x,p.y).y)<.01}));
  });
  for(const display of [displayA,displayB]) {
    await expect.poll(async()=>(await snapshot(display)).filter(p=>p.id===id).length,{timeout:15000}).toBe(1);
    await expect(display.locator('#participant-count')).toHaveText(`Participantes: ${initialCount+1}`);
  }
  await expect(page.locator('#pass-title')).toContainText('Você já está',{timeout:15000});
  const a=(await snapshot(displayA)).find(p=>p.id===id),b=(await snapshot(displayB)).find(p=>p.id===id);
  expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(.4);
  expect(a.follows&&b.follows).toBe(true);
  await displayA.screenshot({path:'test-results/sala5-real.png'});
  await displayA.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').participantsClient.socket.disconnect();});
  await displayA.evaluate(async()=>{const {game}=await import('/js/game.js');game.scene.getScene('WorldScene').participantsClient.socket.connect();});
  await displayB.reload();
  for(const display of [displayA,displayB]) {
    await expect.poll(async()=>(await snapshot(display)).filter(p=>p.id===id).length).toBe(1);
  }
  const duplicate=await request.post('/api/check-in',{multipart:{name:'Nome diferente',email,selfieAiAcknowledged:'true',
    selfie:{name:'selfie.png',mimeType:'image/png',buffer:photo}}});
  expect(duplicate.status()).toBe(200);expect((await duplicate.json()).participant.id).toBe(id);
  expect((await (await request.get('/api/participants')).json()).participants.length).toBe(initialCount+1);
  await displayA.setViewportSize({width:1280,height:720});
  await displayA.keyboard.press('+');await displayA.waitForTimeout(800);await displayA.keyboard.press('0');
  await expect(displayA.locator('.room-label')).toHaveText('Sala 5');
  expect(errors).toEqual([]);await displayA.close();await displayB.close();
});
