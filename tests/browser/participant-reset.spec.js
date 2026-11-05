const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('../helpers/authenticatedApplication');
test('Limpar participantes confirms deletion, empties both displays and accepts the same email again',async({browser})=>{
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-reset-'));
 const r=await createApplication({dataDir,entryDelayMs:0,entrySpacingMs:0,avatarProvider:'local',logger:()=>{}});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));const base=`http://localhost:${r.server.address().port}`;
 const page=await browser.newPage(),second=await browser.newPage(),errors=[];
 for(const display of [page,second]){display.on('pageerror',e=>errors.push(e.message));await display.goto(base+'/tela');}
 const photo=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const checkin=async()=>{const body=new FormData();body.set('selfieAiAcknowledged','true');body.set('name','Teste Limpeza');body.set('email','same-email@example.test');body.set('selfie',new Blob([photo],{type:'image/png'}),'test.png');const response=await fetch(base+'/api/check-in',{method:'POST',body});const session=await response.json();await fetch(base+'/api/participants/'+session.participant.uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+session.reviewToken}});return response;};
 try{
  expect((await checkin()).status).toBe(201);
  for(const display of [page,second])await expect(display.locator('#participant-count')).toHaveText('Participantes: 1');
  await expect(page.locator('#clear-participants')).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#clear-participants').click();expect(r.store.list().length).toBe(1);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#clear-participants').click();
  await expect(page.locator('#clear-participants-status')).toContainText('Você pode reutilizar o e-mail');
  for(const display of [page,second])await expect(display.locator('#participant-count')).toHaveText('Participantes: 0');
  expect(r.store.list().length).toBe(0);expect((await checkin()).status).toBe(201);
  for(const display of [page,second])await expect(display.locator('#participant-count')).toHaveText('Participantes: 1');
  expect(errors).toEqual([]);
 }finally{await page.close();await second.close();await r.close();}
});
