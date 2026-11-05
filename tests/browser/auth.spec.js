const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {createApplication}=require('../../server');
const sharp=require('sharp');
const password='Uma frase administrativa segura 123';
async function start(){await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/browser-real-auth-'));
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:0,entrySpacingMs:0,generatePortrait:async()=>{throw Object.assign(new Error('Synthetic portrait unavailable'),{code:'PORTRAIT_NOT_CONFIGURED'});},storyRenderer:require('../helpers/storyRenderer'),authConfig:{secret:randomBytes(48).toString('hex')},logger:()=>{}});await r.auth.store.create('browser-admin',password);
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,base:`http://localhost:${r.server.address().port}`};}
async function login(page,passwordValue=password){await page.locator('#username').fill('browser-admin');await page.locator('#password').fill(passwordValue);await page.getByRole('button',{name:'ENTRAR',exact:true}).click();}

test('real anonymous visitor stays public; admin login, account management, password changes and logout protect both TV and operator',async({browser})=>{
 const r=await start(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(r.base+'/checkin');await expect(page.locator('#checkin-form')).toBeVisible();
  await page.goto(r.base+'/admin');await expect(page).toHaveURL(/\/login\?next=/);await page.screenshot({path:'test-results/auth-login-mobile.png',fullPage:true});
  await login(page,'wrong');await expect(page.locator('#auth-status')).toHaveText('Usuário ou senha inválidos.');
  await login(page);await expect(page).toHaveURL(r.base+'/admin');await expect(page.locator('#account-name')).toContainText('browser-admin');
  await expect(page.locator('#admin-users button',{hasText:'DESATIVAR'})).toBeDisabled();
  await page.locator('#new-username').fill('second-admin');await page.locator('#new-password').fill(password);await page.locator('#new-confirm').fill(password);await page.locator('#create-admin button').click();
  await expect(page.locator('#admin-users li')).toHaveCount(2);await page.screenshot({path:'test-results/auth-admin-mobile.png',fullPage:true});
  const other=page.locator('#admin-users li',{hasText:'second-admin'});await other.getByRole('button',{name:'REDEFINIR SENHA'}).click();
  await page.locator('#reset-new-password').fill(password+' reset');await page.locator('#reset-confirm').fill(password+' reset');await page.locator('#reset-password button').click();await expect(page.locator('#auth-status')).toHaveText('Alteração concluída.');
  await other.getByRole('button',{name:'DESATIVAR'}).click();await page.locator('#confirm-action button[value="confirm"]').click();await expect(other).toContainText('inativo');
  await page.locator('#current-password').fill(password);await page.locator('#own-new-password').fill(password+' changed');await page.locator('#own-confirm').fill(password+' changed');
  expect(await page.locator('#change-password').evaluate(form=>form.checkValidity())).toBe(true);
  // Dismiss browser/OS password-manager overlays before clicking the submit button.
  await page.locator('#own-confirm').press('Tab');
  const changed=page.waitForResponse(response=>response.url().endsWith('/api/admin/password'),{timeout:15000});
  await page.locator('#change-password button').click();const changedResponse=await changed;expect(changedResponse.status()).toBe(200);
  await expect(page).toHaveURL(r.base+'/login');
  await login(page,password+' changed');await expect(page).toHaveURL(r.base+'/world');
  await expect.poll(()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene')?.participantsClient?.socket.connected;})).toBe(true);
  await page.locator('.account-bar button').click();await expect(page).toHaveURL(r.base+'/login');
  await page.goto(r.base+'/operator');await expect(page).toHaveURL(/\/login/);expect(errors).toEqual([]);
 }finally{await context.close();await r.close();}
});

test('public pass hides reprocessing; authenticated owner retry sends CSRF and preserves the privacy rejection',async({browser})=>{
 const r=await start(),page=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await page.goto(r.base+'/checkin');await page.locator('#name').fill('Visitante Público');await page.locator('#email').fill('auth-pass@example.test');await page.locator('#selfie-ai-acknowledged').check();
  const buffer=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
  await page.locator('#photo').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer});await page.locator('#submit').click();await page.waitForURL(/\/pass\//);
  await expect(page.locator('#enter-world')).toBeEnabled();await page.locator('#enter-world').click();await expect(page.locator('#pass-title')).toContainText('Você já está');
  await expect(page.locator('#retry-portrait')).toBeHidden();const passUrl=page.url();await r.selfieLifecycle.idle();
  await page.goto(r.base+'/admin');await login(page);await expect(page).toHaveURL(r.base+'/admin');await page.goto(passUrl);
  await expect(page.locator('#retry-portrait')).toBeVisible();
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/retry-portrait'));await page.locator('#retry-portrait').click();const response=await responsePromise;
  expect(response.request().headers()['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(response.status()).toBe(409);await expect(page.locator('#pass-status')).toContainText('Selfie original removida por privacidade');
 }finally{await page.close();await r.close();}
});
