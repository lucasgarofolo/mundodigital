const {test,expect}=require('../helpers/browserAuth');
const {createApplication}=require('../helpers/authenticatedApplication');
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),sharp=require('sharp');
async function start(){await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-operations-'));let renders=0;
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:1800,entrySpacingMs:0,logger:()=>{},
  generatePortrait:async()=>{throw Error('Must not call IA');},storyRenderer:{render:async(_data,{outputPath})=>{renders++;await new Promise(resolve=>setTimeout(resolve,80));await fs.writeFile(outputPath,await sharp({create:{width:1080,height:1920,channels:3,background:'#204c47'}}).png().toBuffer());},close:async()=>{}}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,dataDir,base:`http://localhost:${r.server.address().port}`,renders:()=>renders};}
async function seed(r,name,experience='AVATAR_REVIEW'){
 const {createWalker}=await import('../../public/js/movement.js'),uuid=randomUUID();const w=createWalker({id:uuid,name,avatar:`/avatars/${uuid}.png`,avatarKind:'lpc',avatarType:'lpc',avatarStatus:'READY',experienceStatus:experience},0);
 r.store.insert(w,uuid+'@example.test',Date.now());r.store.requestPortrait(uuid);r.store.finishPortrait(uuid,{ready:true,generatedAt:new Date().toISOString()});r.store.db.prepare("UPDATE participants SET selfie_status='DELETED',story_status='READY' WHERE uuid=?").run(uuid);
 await fs.writeFile(path.join(r.dataDir,'avatars',uuid+'.png'),await fs.readFile('public/assets/avatars/lpc/test-avatar.png'));const files=r.passService.paths(uuid);await fs.mkdir(files.directory,{recursive:true});const png=await sharp({create:{width:512,height:512,channels:3,background:'#9cbcaf'}}).png().toBuffer();await fs.writeFile(files.portrait,png);await fs.writeFile(files.story,png);
 if(experience==='ACTIVE')r.walkers.set(uuid,w);return w;
}
const camera=page=>page.evaluate(async()=>{const {game}=await import('/js/game.js');const scene=game.scene.getScene('WorldScene');return {uuid:scene?.cameraController?.focusedParticipantUuid,mode:scene?.cameraController?.cameraMode,people:scene?.characters?.participants.map(p=>p.id)};});

test('operations shows actual counters/search/pagination, live TV detection and tracking; Story/delete actions preserve privacy and assets',async({browser})=>{
 const r=await start(),page=await browser.newPage({viewport:{width:1440,height:1000}}),tv=await browser.newPage(),errors=[];
 for(const p of [page,tv])p.on('pageerror',e=>errors.push(e.message));
 try{
  const lucas=await seed(r,'Lucas Garofolo','ACTIVE');for(let i=0;i<28;i++)await seed(r,'Visitante '+i);
  await page.goto(r.base+'/admin');await expect(page.locator('.metric[data-key=total] dd')).toHaveText('29');await expect(page.locator('.metric[data-key=active] dd')).toHaveText('1');
  await expect(page.locator('#participant-table tr')).toHaveCount(25);await page.locator('#next-page').click();await expect(page.locator('#participant-table tr')).toHaveCount(4);await page.locator('#previous-page').click();
  await expect(page.locator('[data-service=tv]')).toContainText('OFFLINE');await tv.goto(r.base+'/world');await expect.poll(async()=>(await camera(tv)).people?.length).toBe(1);
  await expect(page.locator('[data-service=tv]')).toContainText('ONLINE');await page.locator('#admin-participant-search').fill('LUCAS');await expect(page.locator('#participant-table tr')).toHaveCount(1);
  await page.locator('#participant-filter').selectOption('FAILED');await expect(page.locator('#participant-table tr')).toHaveCount(0);await page.locator('#participant-filter').selectOption('ACTIVE');await expect(page.locator('#participant-table tr')).toHaveCount(1);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/admin-operations-desktop.png',fullPage:true});
  await page.locator('.locate-participant').click();await expect.poll(async()=>(await camera(tv)).uuid).toBe(lucas.id);
  await page.locator('#camera-admin-home').click();await expect.poll(async()=>(await camera(tv)).mode).toBe('HOME');
  await page.locator('#participant-table button',{hasText:'VER'}).click();await expect(page.locator('#participant-detail')).toBeVisible();await expect(page.locator('#participant-detail-body')).toContainText('Selfie original removida');
  await expect(page.locator('[data-action=retry-lpc]')).toBeDisabled();await expect(page.locator('[data-action=retry-portrait]')).toBeDisabled();
  const before=r.renders();await page.locator('[data-action=regenerate-story]').evaluate(button=>{button.click();button.click();});await expect.poll(()=>r.renders()).toBe(before+1);await r.passService.idle();
  await expect(page.locator('[data-action=locate]')).toBeEnabled();await page.locator('[data-action=locate]').click();await expect.poll(async()=>(await camera(tv)).uuid).toBe(lucas.id);
  await page.screenshot({path:'test-results/admin-participant-detail.png'});
  await page.locator('[data-action=remove]').click();await expect(page.locator('#confirm-action')).toBeVisible();await page.locator('#confirm-action button[value=cancel]').click();expect(r.walkers.has(lucas.id)).toBe(true);
  await page.locator('[data-action=remove]').click();await page.locator('#confirm-action button[value=confirm]').click();await expect.poll(()=>r.walkers.has(lucas.id)).toBe(false);
  await expect.poll(async()=>(await camera(tv)).people?.includes(lucas.id)).toBe(false);await expect.poll(async()=>(await camera(tv)).mode).toBe('HOME');
  expect(r.store.findByUuid(lucas.id).status).toBe('INACTIVE');expect(r.visitController.info(lucas).targetPoi).toBe(null);
  expect((await fetch(r.base+'/pass/'+lucas.id)).status).toBe(200);await page.locator('#close-detail').click();
  const rendered=r.renders();await page.reload();await expect(page.locator('.metric[data-key=total] dd')).toHaveText('29');expect(r.renders()).toBe(rendered);
  await tv.close();await expect(page.locator('[data-service=tv]')).toContainText('OFFLINE');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/admin-operations-mobile.png',fullPage:true});expect(errors).toEqual([]);
 }finally{await page.close();if(!tv.isClosed())await tv.close();await r.close();}
});

test('force entry and cancellation use real states without duplicate timers or characters',async({browser})=>{
 const r=await start(),page=await browser.newPage({viewport:{width:1280,height:900}});
 try{const p=await seed(r,'Maria Entrada');await page.goto(r.base+'/admin');await expect(page.locator('.metric[data-key=passReady] dd')).toHaveText('1');await page.locator('#participant-table button',{hasText:'VER'}).click();
  await expect(page.locator('[data-action=force-entry]')).toBeEnabled();await page.locator('[data-action=force-entry]').evaluate(button=>{button.click();button.click();});await expect.poll(()=>r.entryScheduler.size).toBe(1);
  await expect(page.locator('[data-action=force-entry]')).toBeDisabled();await expect(page.locator('[data-action=cancel-entry]')).toBeEnabled();await page.locator('[data-action=cancel-entry]').click();await page.locator('#confirm-action button[value=confirm]').click();
  await expect.poll(()=>r.entryScheduler.size).toBe(0);expect(r.store.findByUuid(p.id).experienceStatus).toBe('AVATAR_REVIEW');await page.waitForTimeout(1900);expect(r.walkers.has(p.id)).toBe(false);
  await expect(page.locator('[data-action=force-entry]')).toBeEnabled();await page.locator('[data-action=force-entry]').click();await expect.poll(()=>r.walkers.has(p.id),{timeout:10000}).toBe(true);expect(r.walkers.size).toBe(1);await expect(page.locator('[data-action=force-entry]')).toBeDisabled();
 }finally{await page.close();await r.close();}
});
