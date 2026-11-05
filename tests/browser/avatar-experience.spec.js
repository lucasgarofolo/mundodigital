const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('../helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../../lib/avatarCatalog');
const {passConfig}=require('../../lib/passView');
const photo=()=>sharp({create:{width:512,height:512,channels:3,background:'#d9d9d9'}}).png().toBuffer();
async function start(options={}){
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-credential-'));
 const r=await createApplication({dataDir,avatarProvider:'local',generatePortrait:photo,storyRenderer:require('../helpers/storyRenderer'),logger:()=>{},...options});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,base:`http://localhost:${r.server.address().port}`};
}
async function fill(phone,email){
 await phone.locator('#name').fill('Lucas');await phone.locator('#email').fill(email);
 await phone.locator('#selfie-ai-acknowledged').check();await phone.locator('#photo').setInputFiles({name:'test.png',mimeType:'image/png',buffer:await photo()});await expect(phone.locator('#preview')).toBeVisible();
 const pending=await require('../helpers/captureCheckin')(phone);
 await phone.locator('#submit').click();const response=await pending.result;expect(response.status).toBe(201);const body=response.body;
 await phone.waitForURL(/\/pass\//);return body;
}
const count=page=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.length;});

test('credential replaces separate approval, parallel assets recover on refresh and one click schedules real 8-second entry with phone closed',async({browser})=>{
 let releaseLpc,releasePortrait,portraitCalls=0;const lpcGate=new Promise(resolve=>{releaseLpc=resolve;}),portraitGate=new Promise(resolve=>{releasePortrait=resolve;});
 const r=await start({entryDelayMs:8000,analyzeSelfie:async()=>{await lpcGate;return DEFAULT_AVATAR;},generatePortrait:async()=>{portraitCalls++;await portraitGate;return photo();}});
 const phone=await browser.newPage({viewport:{width:390,height:844}}),tv=await browser.newPage(),errors=[];
 for(const p of [phone,tv])p.on('pageerror',e=>errors.push(e.message));
 try{
  await tv.goto(r.base+'/tela');await expect.poll(()=>count(tv)).toBe(0);await phone.goto(r.base+'/check-in');const s=await fill(phone,'credential@example.test');
  await expect(phone.locator('#pass-processing')).toBeVisible();expect(await count(tv)).toBe(0);await expect.poll(()=>portraitCalls).toBe(1);
  await phone.reload();await expect(phone.locator('#pass-processing')).toBeVisible();
  releasePortrait();await expect.poll(()=>r.store.findByUuid(s.participant.uuid).portraitStatus).toBe('READY');await expect(phone.locator('#pass-card')).toBeHidden();expect(await count(tv)).toBe(0);
  releaseLpc();await expect(phone.locator('#enter-world')).toBeEnabled();await expect(phone.locator('img.portrait')).toBeVisible();await expect(phone.locator('.lpc-figure')).toBeVisible();
  await expect(phone.locator('#share-actions')).toBeHidden();expect(await phone.locator('#approve-avatar').count()).toBe(0);expect(await phone.locator('#regenerate-avatar').count()).toBe(0);
  expect(await phone.locator('.lpc-figure').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(r.store.findByUuid(s.participant.uuid).avatar);
  await phone.reload();await expect(phone.locator('#enter-world')).toBeEnabled();await phone.screenshot({path:'test-results/credential-ready-mobile.png',fullPage:true});expect(await count(tv)).toBe(0);
  await tv.evaluate(async()=>{const {game}=await import('/js/game.js');const manager=game.scene.getScene('WorldScene').characters,original=manager.addParticipant.bind(manager);manager.addParticipant=(data,options)=>{const p=original(data,options);window.entrySnapshot={y:p.y,state:p.state,labels:p.visual.list.filter(o=>o.type==='Text').map(o=>o.text)};return p;};});
  let approvals=0;phone.on('request',req=>{if(req.url().endsWith('/approve-avatar'))approvals++;});
  const before=Date.now();await phone.locator('#enter-world').evaluate(button=>{button.click();button.click();});
  await expect(phone.locator('#pass-title')).toContainText('Olhe para a TV');await expect(phone.locator('#share-actions')).toBeVisible();expect(approvals).toBe(1);
  const scheduled=r.store.findByUuid(s.participant.uuid).scheduledEntryAt;
  await phone.reload();await expect(phone.locator('#pass-title')).toContainText('Olhe para a TV');expect(r.store.findByUuid(s.participant.uuid).scheduledEntryAt).toBe(scheduled);
  await phone.screenshot({path:'test-results/credential-look-at-tv.png',fullPage:true});const saved=await phone.evaluate(()=>localStorage.getItem('senai-participant-session'));await phone.close();
  await tv.waitForTimeout(2500);expect(await count(tv)).toBe(0);await expect.poll(()=>count(tv),{timeout:15000}).toBe(1);expect(Date.now()-before).toBeGreaterThanOrEqual(7900);
  const entry=await tv.evaluate(()=>window.entrySnapshot);expect(entry.y).toBeGreaterThan(9);expect(entry.state).toBe('ENTERING');expect(entry.labels).toContain('Lucas chegou!');
  await expect.poll(()=>r.store.findByUuid(s.participant.uuid).experienceStatus).toBe('ACTIVE');await tv.reload();await expect.poll(()=>count(tv)).toBe(1);
  const resumed=await browser.newPage({viewport:{width:390,height:844}});await resumed.addInitScript(value=>localStorage.setItem('senai-participant-session',value),saved);await resumed.goto(r.base+'/check-in');await resumed.waitForURL(/\/pass\//);
  await expect(resumed.locator('#pass-title')).toContainText('Você já está');await expect(resumed.locator('#save-story')).toBeEnabled();await resumed.close();expect(portraitCalls).toBe(1);expect(errors).toEqual([]);
 }finally{releaseLpc();releasePortrait();await phone.close();await tv.close();await r.close();}
});

test('failed portrait and fallback LPC still produce a usable credential; equal names enter independently',async({browser})=>{
 const r=await start({entryDelayMs:100,entrySpacingMs:150,analyzeSelfie:async()=>{throw Error('offline');},generatePortrait:async()=>{throw Object.assign(Error('portrait unavailable'),{code:'PORTRAIT_HTTP_ERROR',status:401});}});
 const phone=await browser.newPage({viewport:{width:390,height:844}}),tv=await browser.newPage();
 try{
  await tv.goto(r.base+'/tela');await phone.goto(r.base+'/check-in');const s=await fill(phone,'credential-fallback@example.test');
  await expect(phone.locator('#enter-world')).toBeEnabled();await expect(phone.locator('.portrait-placeholder')).toBeVisible();expect(await count(tv)).toBe(0);
  expect(r.store.findByUuid(s.participant.uuid).avatarStatus).toBe('FALLBACK');await phone.locator('#enter-world').click();await expect.poll(()=>count(tv)).toBe(1);await expect(phone.locator('#save-story')).toBeEnabled();
  const sessions=await Promise.all(Array.from({length:5},async(_,i)=>{const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name','Lucas');form.set('email',`credential-name-${i}@example.test`);form.set('selfie',new Blob([await photo()],{type:'image/png'}),'test.png');return (await fetch(r.base+'/api/check-in',{method:'POST',body:form})).json();}));
  await expect.poll(()=>r.store.listRegistered().filter(p=>p.experienceStatus==='AVATAR_REVIEW').length).toBe(5);expect(await count(tv)).toBe(1);
  for(const value of sessions)expect((await fetch(`${r.base}/api/participants/${value.participant.uuid}/approve-avatar`,{method:'POST',headers:{Authorization:'Bearer '+value.reviewToken}})).status).toBe(200);
  await expect.poll(()=>count(tv)).toBe(6);expect(new Set((await (await fetch(r.base+'/api/world')).json()).participants.map(p=>p.uuid)).size).toBe(6);await tv.reload();await expect.poll(()=>count(tv)).toBe(6);
 }finally{await phone.close();await tv.close();await r.close();}
});

test('slow portrait releases credential after bounded wait; placeholder Story updates without recreating LPC',async({browser})=>{
 expect(passConfig({}).portraitWaitMs).toBe(15000);
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const r=await start({entryDelayMs:100,passConfig:{portraitWaitMs:3000,edition:'2026'},generatePortrait:async()=>{calls++;await gate;return photo();}}),phone=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await phone.goto(r.base+'/check-in');const s=await fill(phone,'credential-slow@example.test'),uuid=s.participant.uuid;
  await expect(phone.locator('#pass-processing')).toBeVisible();expect(r.walkers.size).toBe(0);const avatar=r.store.findByUuid(uuid).avatar;
  await expect(phone.locator('#enter-world')).toBeEnabled({timeout:10000});await expect(phone.locator('.portrait-placeholder')).toBeVisible();await expect(phone.locator('#share-actions')).toBeHidden();
  await phone.locator('#enter-world').click();await expect(phone.locator('#share-actions')).toBeVisible();await expect(phone.locator('#save-story')).toBeEnabled();
  const hash=r.store.findByUuid(uuid).storyHash;expect(hash).toBeTruthy();release();
  await expect(phone.locator('img.portrait')).toBeVisible();await expect.poll(()=>r.store.findByUuid(uuid).storyHash).not.toBe(hash);await expect(phone.locator('#save-story')).toBeEnabled();
  expect(r.store.findByUuid(uuid).avatar).toBe(avatar);expect(calls).toBe(1);await phone.reload();await expect(phone.locator('#share-actions')).toBeVisible();expect(calls).toBe(1);
 }finally{release();await phone.close();await r.close();}
});
