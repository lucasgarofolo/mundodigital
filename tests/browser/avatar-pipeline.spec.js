const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {createApplication}=require('../helpers/authenticatedApplication');
const {DEFAULT_AVATAR}=require('../../lib/avatarCatalog');

test('background LPC swap preserves character; duplicates, 5/10 load, refresh and restart retain distinct UUID textures',async({browser})=>{
 const root=path.resolve('.test-data');await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'browser-avatar-pipeline-'));
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const options={dataDir,entryDelayMs:200,entrySpacingMs:0,logger:()=>{},analyzeSelfie:async photo=>{
  calls++;await gate;const {data}=await sharp(photo).raw().toBuffer({resolveWithObject:true});
  return {...DEFAULT_AVATAR,hairStyle:data[0]>100?'long':'buzzcut',hairColor:data[0]>100?'blonde':'black',glasses:'rectangular'};
 }};
 async function start(){const app=await createApplication(options);app.server.listen(0);await new Promise(resolve=>app.server.once('listening',resolve));return {...app,base:`http://localhost:${app.server.address().port}`};}
 let runtime=await start();const display=await browser.newPage(),form=await browser.newPage();const errors=[],loads=new Map();
 for(const page of [display,form]){
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 }
 display.on('request',r=>{if(r.url().includes('/avatars/'))loads.set(r.url(),(loads.get(r.url())||0)+1);});
 const count=()=>display.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.length;});
 try{
  await display.goto(runtime.base+'/tela');await expect.poll(count).toBe(0);
  await display.evaluate(async()=>{
   const {game}=await import('/js/game.js');const manager=game.scene.getScene('WorldScene').characters;
   const original=manager.setParticipantAvatar.bind(manager);window.avatarSwaps=[];
   manager.setParticipantAvatar=(id,data)=>{
    const p=manager.participantsById.get(id),before={position:{...p.position},state:p.state,depth:p.visual.depth};
    const container=p.visual,label=p.visual.list[2],shadow=p.visual.list[0],route=p.route,destination=p.destination;
    original(id,data);const after=manager.participantsById.get(id);
    window.avatarSwaps.push({before,after:{position:{...after.position},state:after.state,depth:after.visual.depth},
     same:p===after&&container===after.visual&&label===after.visual.list[2]&&shadow===after.visual.list[0]&&route===after.route&&destination===after.destination});
   };
  });
  await form.goto(runtime.base+'/check-in');await expect(form.locator('#provider-note')).toContainText('crachá');
  await form.locator('#name').fill('Lucas');await form.locator('#email').fill('lucas-ui@example.test');
  const red=await sharp({create:{width:64,height:64,channels:3,background:'#dd0000'}}).png().toBuffer();
  await form.locator('#selfie-ai-acknowledged').check();await form.locator('#photo').setInputFiles({name:'test.png',mimeType:'image/png',buffer:red});
  await expect(form.locator('#preview')).toBeVisible();
  const responsePromise=await require('../helpers/captureCheckin')(form);
  await form.locator('#submit').click();const response=await responsePromise.result;expect(response.status).toBe(201);
  const first=response.body.participant;expect(first.avatarStatus).toBe('PENDING');
  await form.waitForURL(/\/pass\//);await expect.poll(count).toBe(0);await expect(form.locator('#pass-processing')).toBeVisible();
  expect(runtime.store.findByUuid(first.uuid).avatarStatus).toBe('PENDING');
  await display.waitForTimeout(400);release();await runtime.avatarPipeline.idle();
  const ready=runtime.store.findByUuid(first.uuid);expect(ready.avatarStatus).toBe('READY');
  await expect(form.locator('#enter-world')).toBeEnabled();expect(await count()).toBe(0);await form.locator('#enter-world').click();await expect.poll(count).toBe(1);
  const current=()=>display.evaluate(async id=>{const {game}=await import('/js/game.js');const p=game.scene.getScene('WorldScene').characters.participantsById.get(id);return {key:p.avatarSource,type:p.avatar.type,scale:p.avatar.scaleX};},first.uuid);
  await expect.poll(async()=>(await current()).key).toContain(ready.avatarVersion);
  expect((await current()).type).toBe('Sprite');expect((await current()).scale).toBe(1.5);
  const swaps=await display.evaluate(()=>window.avatarSwaps);expect(swaps.length).toBe(0);
  // Repeated identical events should not reload a sheet or duplicate a walker.
  for(let i=0;i<3;i++)runtime.io.to('live').emit('participant:avatar-updated',{uuid:first.uuid,avatarUrl:ready.avatar,
   avatarType:'lpc',avatarKind:'lpc',avatarStatus:'READY',avatarVersion:ready.avatarVersion});
  await display.waitForTimeout(300);expect(await count()).toBe(1);
  expect(loads.get(runtime.base+ready.avatar)).toBe(1);
  const originalCalls=calls;
  await display.reload();await expect.poll(count).toBe(1);await expect.poll(async()=>(await current()).key).toContain(ready.avatarVersion);expect(calls).toBe(originalCalls);
  await form.close();await display.goto('about:blank');
  await runtime.close();runtime=await start();
  await display.goto(runtime.base+'/tela');await expect.poll(count).toBe(1);expect(calls).toBe(originalCalls);

  for(const batch of [5,10]){
   const participants=await Promise.all(Array.from({length:batch},async(_,i)=>{
    const body=new FormData();body.set('selfieAiAcknowledged','true');body.set('name','Lucas');body.set('email',`load-${batch}-${i}@example.test`);
    const image=await sharp({create:{width:64,height:64,channels:3,background:i%2?'#dd0000':'#330000'}}).png().toBuffer();
    body.set('selfie',new Blob([image],{type:'image/png'}),'test.png');
    const res=await fetch(runtime.base+'/api/check-in',{method:'POST',body});expect(res.status).toBe(201);const session=await res.json();return {...session.participant,reviewToken:session.reviewToken};
   }));
   await expect.poll(()=>runtime.store.listRegistered().filter(p=>p.avatarStatus==='READY').length,{timeout:30000}).toBe(batch===5?6:16);
   await Promise.all(participants.map(p=>fetch(runtime.base+'/api/participants/'+p.uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+p.reviewToken}})));
   await expect.poll(count).toBe(batch===5?6:16);
   const ids=participants.map(p=>p.uuid);
   await expect.poll(()=>display.evaluate(async ids=>{
    const {game}=await import('/js/game.js');const s=game.scene.getScene('WorldScene');
    return ids.every(id=>{const p=s.characters.participantsById.get(id),latest=s.participantsClient.latest.get(id);return p.avatarSource===s.participantsClient.textureKey(latest)&&latest.avatarStatus==='READY';});
   },ids),{timeout:30000}).toBe(true);
   const actual=await display.evaluate(async ids=>{
    const {game}=await import('/js/game.js');const s=game.scene.getScene('WorldScene');return ids.map(id=>({id,key:s.characters.participantsById.get(id).avatarSource}));
   },ids);
   expect(new Set(actual.map(p=>p.key)).size).toBe(batch);
   for(const p of actual)expect(p.key).toContain(p.id);
  }
  await display.screenshot({path:'test-results/avatar-pipeline-ready.png'});
  expect(errors).toEqual([]);
 }finally{release();await display.close();await form.close();await runtime.close();}
});

test('seven personalization failures still leave seven animated LPC participants in Phaser',async({page})=>{
 const root=path.resolve('.test-data');await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'browser-avatar-fallback-'));
 let calls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const runtime=await createApplication({dataDir,entryDelayMs:0,entrySpacingMs:0,logger:()=>{},avatarTimeoutMs:50,
  analyzeSelfie:async()=>{
   const index=++calls;
   if(index===3)return new Promise(()=>{});
   if(index===6)return {...DEFAULT_AVATAR,top:'not-in-catalog'};
   if(index===7)return DEFAULT_AVATAR;
   throw Object.assign(new Error('Controlled failure'),{code:{1:'GEMINI_API_ERROR',2:'GEMINI_API_ERROR',4:'PHOTO_MISSING',5:'INVALID_JSON'}[index]});
  },buildLpcAvatar:async()=>{throw new Error('Controlled builder failure');}});
 runtime.server.listen(0);await new Promise(resolve=>runtime.server.once('listening',resolve));
 const base=`http://localhost:${runtime.server.address().port}`;
 try{
  await page.goto(base+'/tela');
  const image=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
  const sessions=[];for(let i=0;i<7;i++){
   const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name','Teste Fallback');form.set('email',`fallback-${i}@example.test`);
   form.set('selfie',new Blob([image],{type:'image/png'}),'test.png');
   const response=await fetch(base+'/api/check-in',{method:'POST',body:form});expect(response.status).toBe(201);sessions.push(await response.json());
  }
  await expect.poll(()=>runtime.store.listRegistered().filter(p=>p.avatarStatus==='FALLBACK').length).toBe(7);
  await Promise.all(sessions.map(s=>fetch(base+'/api/participants/'+s.participant.uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+s.reviewToken}})));
  await expect.poll(()=>page.evaluate(async()=>{
   const {game}=await import('/js/game.js');const s=game.scene.getScene('WorldScene');
   return s.characters?.participants.filter(p=>p.avatar.type==='Sprite'&&p.avatar.visible&&p.avatarType==='lpc').length;
  })).toBe(7);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');await runtime.close();}
});
