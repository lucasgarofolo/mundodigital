const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createApplication}=require('../helpers/authenticatedApplication');
const {storyHtml}=require('../../lib/passView');
async function portrait(){return sharp(Buffer.from('<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><path fill="#d9d9d9" d="M0 0h512v512H0z"/><path fill="#302a32" d="M144 80h224v240H144z"/><path fill="#dbb695" d="M176 144h160v192H176z"/><path fill="#23343b" d="M200 208h24v24h-24zM288 208h24v24h-24z"/><path fill="#557fa3" d="M112 368h288v144H112z"/></svg>')).png().toBuffer();}
async function start(options={}){
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-pass-'));
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:20,entrySpacingMs:0,logger:()=>{},...options});r.server.listen(0);
 await new Promise(resolve=>r.server.once('listening',resolve));return {...r,base:`http://localhost:${r.server.address().port}`};
}
async function register(r,name){const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name',name);form.set('email','private-browser@example.test');form.set('selfie',new Blob([await portrait()],{type:'image/png'}),'private.png');return (await fetch(r.base+'/api/check-in',{method:'POST',body:form})).json();}
const authorize=s=>({Authorization:'Bearer '+s.reviewToken});
const approve=(r,s)=>fetch(`${r.base}/api/participants/${s.participant.uuid}/approve-avatar`,{method:'POST',headers:authorize(s)});

test('mobile pass recovers processing, updates portrait, shares the cached Story file and preserves LPC entry',async({browser})=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const r=await start({passConfig:{portraitWaitMs:0,edition:'2026'},generatePortrait:async()=>{calls++;await gate;return portrait();}}),phone=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 let pass;
 try{
  phone.on('pageerror',e=>errors.push(e.message));await phone.goto(r.base+'/check-in');
  await phone.locator('#name').fill('Lucas Garofolo');await phone.locator('#email').fill('private-browser@example.test');
  await phone.locator('#selfie-ai-acknowledged').check();await phone.locator('#photo').setInputFiles({name:'private.png',mimeType:'image/png',buffer:await portrait()});await expect(phone.locator('#preview')).toBeVisible();
  await phone.locator('#submit').click();await phone.waitForURL(/\/pass\//);await expect(phone.locator('#enter-world')).toBeEnabled();await phone.locator('#enter-world').click();
  await expect(phone.locator('#pass-title')).toContainText('Olhe para a TV');const href=new URL(phone.url()).pathname;
  pass=await browser.newPage({viewport:{width:390,height:844}});pass.on('pageerror',e=>errors.push(e.message));
  await pass.addInitScript(()=>{
   Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>{window.canShareCalls=(window.canShareCalls||0)+1;return data.files?.length===1;}});
   Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{const file=data.files[0];window.shared={name:file.name,type:file.type,size:file.size,signature:[...new Uint8Array(await file.arrayBuffer())].slice(0,8)};}});
  });
  await pass.goto(r.base+href);await expect(pass.locator('.portrait-placeholder')).toContainText('Preparando seu portrait');await expect(pass.locator('.pass-person h1')).toHaveText('Lucas Garofolo');
  await pass.reload();await expect(pass.locator('.portrait-placeholder')).toBeVisible();expect(calls).toBe(1);
  await expect.poll(()=>r.store.list()[0].experienceStatus).toBe('ACTIVE');expect(r.walkers.size).toBe(1);release();
  await expect(pass.locator('img.portrait')).toBeVisible({timeout:20000});await expect(pass.locator('#share-pass')).toBeEnabled({timeout:20000});
  await pass.screenshot({path:'test-results/pass-mobile.png',fullPage:true});
  expect(await pass.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await pass.locator('#share-pass').click();await expect.poll(()=>pass.evaluate(()=>window.shared?.type)).toBe('image/png');
  const shared=await pass.evaluate(()=>window.shared);expect(shared.signature).toEqual([137,80,78,71,13,10,26,10]);expect(shared.size).toBeGreaterThan(1000);expect(await pass.evaluate(()=>window.canShareCalls)).toBe(1);
  const p=r.store.list()[0];expect(await pass.locator('.lpc-figure').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(p.avatar);
  expect(await pass.locator('.person-role').count()).toBe(0);expect(await pass.locator('.person-organization').count()).toBe(0);
  await pass.reload();await expect(pass.locator('#share-pass')).toBeEnabled();expect(calls).toBe(1);expect(errors).toEqual([]);
 }finally{release();await phone.close();await pass?.close();await r.close();}
});

test('desktop download fallback, explicit optional fields, long-name Story layout and unchanged export cache',async({browser})=>{
 let calls=0;const r=await start({generatePortrait:async()=>{calls++;return portrait();}}),page=await browser.newPage({viewport:{width:1440,height:1000}});
 let story;
 try{
  const name='Maria Eduarda de Albuquerque e Vasconcelos da Silva Oliveira';
  const s=await register(r,name),uuid=s.participant.uuid;await approve(r,s);await r.passService.idle();
  const profile={role:'Visitante da mostra de projetos e oportunidades profissionais',organization:'Instituição de ensino informada pela participante',profileTag:'Tecnologia e inovação',highlight:'Minha experiência no Mundo // Digital'};
  const response=await fetch(`${r.base}/api/participants/${uuid}/pass-profile`,{method:'PUT',headers:{...authorize(s),'Content-Type':'application/json'},body:JSON.stringify(profile)});expect(response.status).toBe(200);await r.passService.idle();
  await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});});
  await page.goto(r.base+'/pass/'+uuid);await expect(page.locator('#save-story')).toBeEnabled();await expect(page.locator('.pass-person h1')).toHaveText(name);await expect(page.locator('.person-role')).toHaveText(profile.role);await expect(page.locator('.person-organization')).toHaveText(profile.organization);
  await page.screenshot({path:'test-results/pass-desktop.png',fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.locator('#share-pass').click();const download=await downloadPromise;
  const metadata=await sharp(await fs.readFile(await download.path())).metadata();expect(metadata.width).toBe(1080);expect(metadata.height).toBe(1920);expect(download.suggestedFilename()).toMatch(/mundo-digital-MS.*\.png/);
  await expect(page.locator('#pass-status')).toContainText('Download iniciado');
  const d=(await (await fetch(r.base+'/api/pass/'+uuid)).json()).pass;
  for(const secret of ['private-browser@example.test',s.reviewToken,'photoPath'])expect(JSON.stringify(d)).not.toContain(secret);
  story=await browser.newPage({viewport:{width:1080,height:1920}});await story.goto(r.base+'/pass/'+uuid);
  const css=await fs.readFile('public/css/pass.css','utf8');await story.setContent(storyHtml(d,css));await story.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
  const layout=await story.evaluate(()=>[...document.querySelectorAll('.pass-card h1,.pass-card p,.pass-card strong,.story-bottom')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,left:r.left,right:r.right,bottom:r.bottom};}));
  for(const item of layout){expect(item.left,item.text).toBeGreaterThanOrEqual(0);expect(item.right,item.text).toBeLessThanOrEqual(1080);expect(item.bottom,item.text).toBeLessThan(1920);}
  await story.screenshot({path:'test-results/pass-story-long-name.png'});const hash=r.store.findByUuid(uuid).storyHash;
  await page.reload();await expect(page.locator('#save-story')).toBeEnabled();expect(r.store.findByUuid(uuid).storyHash).toBe(hash);expect(calls).toBe(1);
 }finally{await story?.close();await page.close();await r.close();}
});
