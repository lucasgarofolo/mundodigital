const {test,expect}=require('../helpers/browserAuth');
const {createApplication}=require('../helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../../lib/avatarCatalog');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const photo=()=>sharp({create:{width:512,height:512,channels:3,background:'#b8d0d1'}}).png().toBuffer();

test('mobile notice precedes capture, acknowledgement gates upload, and pass/TV/Story survive automatic selfie deletion and refresh',async({browser})=>{
 let release;const hold=new Promise(resolve=>{release=resolve;});
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-selfie-privacy-'));
 const r=await createApplication({dataDir,avatarProvider:'openrouter',analyzeSelfie:async()=>DEFAULT_AVATAR,avatarTimeoutMs:0,
  generatePortrait:async filename=>{await hold;expect((await fs.stat(filename)).size).toBeGreaterThan(0);return photo();},
  entryDelayMs:0,entrySpacingMs:0,storyRenderer:require('../helpers/storyRenderer'),selfiePrivacyPolicyUrl:'/privacidade',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const phone=await browser.newPage({viewport:{width:390,height:844}}),tv=await browser.newPage(),errors=[];
 for(const p of [phone,tv])p.on('pageerror',e=>errors.push(e.message));
 try{
  await phone.goto(base+'/check-in?new');await expect(phone.locator('#selfie-notice-title')).toBeVisible();
  await expect(phone.locator('.selfie-notice')).toContainText('apagada do servidor do Mundo // Digital');
  await expect(phone.locator('.selfie-notice')).toContainText('suas próprias políticas de privacidade');
  await expect(phone.locator('#selfie-privacy-policy')).toHaveAttribute('href','/privacidade');
  const notice=await phone.locator('.selfie-notice').boundingBox(),capture=await phone.locator('.photo-zone').boundingBox();expect(notice.y).toBeLessThan(capture.y);
  await phone.locator('#name').fill('Visitante Privacidade');await phone.locator('#email').fill('privacy-browser@example.test');
  await phone.locator('#photo').setInputFiles({name:'private.png',mimeType:'image/png',buffer:await photo()});await expect(phone.locator('#preview')).toBeVisible();
  await expect(phone.locator('#submit')).toBeDisabled();
  await phone.evaluate(()=>document.getElementById('checkin-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(r.store.list()).toHaveLength(0);
  await phone.locator('#selfie-ai-acknowledged').check();await expect(phone.locator('#submit')).toBeEnabled();
  await phone.screenshot({path:'test-results/selfie-privacy-notice-mobile.png',fullPage:true});
  const pending=await require('../helpers/captureCheckin')(phone);await phone.locator('#submit').click();
  const response=await pending.result;expect(response.status).toBe(201);const session=response.body,id=session.participant.uuid;
  await phone.waitForURL(/\/pass\//);await r.avatarPipeline.idle();
  let p=r.store.findByUuid(id);expect(p.avatarStatus).toBe('READY');expect(p.portraitStatus).toBe('PROCESSING');expect(p.photoPath).toBeTruthy();
  expect(p.selfieAiAcknowledgedAt).toBeTruthy();expect(p.selfieNoticeVersion).toBe('1.0');
  release();await r.passService.idle();await r.selfieLifecycle.idle();
  p=r.store.findByUuid(id);expect(p.photoPath).toBeNull();expect(p.selfieStatus).toBe('DELETED');
  await expect(phone.locator('#enter-world')).toBeEnabled();await phone.locator('#enter-world').click();
  await expect(phone.locator('#pass-title')).toContainText('Você já está',{timeout:15000});
  await expect(phone.locator('#save-story')).toBeEnabled();await phone.reload();await expect(phone.locator('#save-story')).toBeEnabled();
  await phone.goto(base+'/check-in');await phone.waitForURL(new RegExp('/pass/'+id));await expect(phone.locator('#save-story')).toBeEnabled();
  await tv.goto(base+'/tela');await expect.poll(()=>tv.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.length;})).toBe(1);
  await tv.reload();await expect.poll(()=>tv.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants[0]?.avatarType;})).toBe('lpc');
  const pass=await(await fetch(base+'/api/pass/'+id)).json();expect((await fetch(base+pass.pass.portraitUrl)).status).toBe(200);expect((await fetch(base+pass.pass.storyUrl)).status).toBe(200);
  expect(errors).toEqual([]);
 }finally{release();await phone.close();await tv.close();await r.close();}
});
