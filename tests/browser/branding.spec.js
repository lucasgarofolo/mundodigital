const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('../helpers/authenticatedApplication');

test('neutral branding preserves mobile credential, entry, Story, world and operator layouts',async({browser})=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const image=await sharp({create:{width:512,height:512,channels:3,background:'#aecac5'}}).png().toBuffer();
 const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-branding-'));
 const r=await createApplication({dataDir,avatarProvider:'local',generatePortrait:async()=>{await pending;return image;},
  passConfig:{portraitWaitMs:60000,edition:'2026',instagramHandle:'',hashtag:'#MundoDigital'},entryDelayMs:1200,entrySpacingMs:0,logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const phone=await browser.newPage({viewport:{width:390,height:844}}),world=await browser.newPage(),operator=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 for(const page of [phone,world,operator])page.on('pageerror',error=>errors.push(error.message));
 const neutral=async page=>{expect(await page.title()).toContain('Mundo // Digital');expect(await page.locator('body').innerText()).not.toMatch(/senai/i);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);};
 try{
  await phone.goto(base+'/check-in?new');await neutral(phone);
  await expect(phone.locator('header')).toContainText('Mundo //Digital');
  await phone.screenshot({path:'test-results/branding-checkin-mobile.png',fullPage:true});
  await phone.locator('#name').fill('Visitante Branding');await phone.locator('#email').fill('branding@example.test');
  await phone.locator('#selfie-ai-acknowledged').check();await phone.locator('#photo').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
  await phone.locator('#submit').click();await phone.waitForURL(/\/pass\//);
  await expect(phone.locator('#pass-title')).toHaveText('Preparando seu crachá do Mundo // Digital…');await neutral(phone);
  release();await r.avatarPipeline.idle();await r.passService.idle();
  await expect(phone.locator('#enter-world')).toBeEnabled();await expect(phone.locator('#enter-world')).toHaveText('ENTRAR NO MUNDO // DIGITAL');
  await expect(phone.locator('.pass-brand')).toHaveText('Mundo // Digital');await expect(phone.locator('.school-handle')).toHaveCount(0);
  expect(await phone.locator('#enter-world').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await neutral(phone);
  await phone.screenshot({path:'test-results/branding-pass-mobile.png',fullPage:true});
  await phone.locator('#enter-world').click();await expect(phone.locator('#pass-intro')).toHaveText('Tudo pronto! Seu avatar está entrando no Mundo // Digital.');
  await expect(phone.locator('#pass-title')).toHaveText('Você já está no Mundo // Digital.',{timeout:15000});
  await expect(phone.locator('#save-story')).toBeEnabled();await neutral(phone);
  const p=r.store.list()[0],story=r.passService.paths(p.uuid).story,metadata=await sharp(story).metadata();
  expect([metadata.width,metadata.height]).toEqual([1080,1920]);await fs.copyFile(story,'test-results/branding-story.png');
  // A visitor's institution is their data, independent of the system brand.
  r.store.updatePassProfile(p.uuid,{organization:'SENAI'});
  const supplied=r.passService.data(r.store.findByUuid(p.uuid));expect(supplied.organization).toBe('SENAI');
  await world.goto(base+'/tela');await expect(world.locator('#camera-home')).toBeEnabled();await neutral(world);
  await expect(world.locator('#camera-status')).toHaveText('Visão de entrada do Mundo // Digital.');
  await world.screenshot({path:'test-results/branding-world.png'});
  await operator.goto(base+'/operator');await expect(operator.locator('#camera-home')).toBeEnabled();await neutral(operator);
  await expect(operator.locator('.brand')).toHaveText('Mundo // Digital');await operator.screenshot({path:'test-results/branding-operator-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
 }finally{release();await phone.close();await world.close();await operator.close();await r.close();}
});
