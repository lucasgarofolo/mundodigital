const {test,expect}=require('../helpers/browserAuth');
const fs=require('node:fs'),path=require('node:path');
const cameraVideo=path.resolve('.test-data/selfie-camera.y4m');fs.mkdirSync(path.dirname(cameraVideo),{recursive:true});
const frame=Buffer.concat([Buffer.from('FRAME\n'),Buffer.alloc(320*240,150),Buffer.alloc(320*240/2,128)]);
fs.writeFileSync(cameraVideo,Buffer.concat([Buffer.from('YUV4MPEG2 W320 H240 F10:1 Ip A1:1 C420jpeg\n'),...Array(20).fill(frame)]));
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${cameraVideo}`]},permissions:['camera']});

test('/tela remains empty without active check-ins, including after refresh',async({page})=>{
 const {createApplication}=require('../helpers/authenticatedApplication');const dataDir=fs.mkdtempSync(path.resolve('.test-data/empty-world-'));
 const runtime=await createApplication({dataDir,avatarProvider:'local',logger:()=>{}});
 runtime.server.listen(0);await new Promise(resolve=>runtime.server.once('listening',resolve));
 const url=`http://localhost:${runtime.server.address().port}/tela`;
 const count=()=>page.evaluate(async()=>{const {game}=await import('/js/game.js');return game.scene.getScene('WorldScene').characters?.participants.length;});
 try{await page.goto(url);await expect.poll(count).toBe(0);await page.reload();await expect.poll(count).toBe(0);
  await expect(page.locator('#participant-count')).toHaveText('Participantes: 0');
 }finally{await page.goto('about:blank');await runtime.close();}
});

test('Tirar selfie uses live camera, captures JPEG and stops tracks; picker stays separate',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.cameraStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.lastCameraConstraints=constraints;const stream=await original(constraints);window.cameraStreams.push(stream);return stream;
  };
 });
 await page.goto('/check-in');
 expect(await page.evaluate(()=>window.cameraStreams.length)).toBe(0);
 let pickers=0;page.on('filechooser',()=>pickers++);
 await page.getByRole('button',{name:'Tirar selfie',exact:true}).click();
 await expect(page.locator('#camera-preview')).toBeVisible();await expect(page.locator('#take-photo')).toBeEnabled();
 expect(pickers).toBe(0);
 const constraints=await page.evaluate(()=>window.lastCameraConstraints);
 expect(constraints.audio).toBe(false);expect(constraints.video.facingMode.ideal).toBe('user');
 await page.screenshot({path:'test-results/selfie-camera-live.png'});
 await page.locator('#take-photo').click();await expect(page.locator('#preview')).toBeVisible();
 await expect(page.locator('#camera-preview')).toBeHidden();
 const dimensions=await page.locator('#preview').evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));
 expect(dimensions.width).toBeGreaterThanOrEqual(32);expect(dimensions.height).toBeGreaterThanOrEqual(32);
 expect(await page.evaluate(()=>window.cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 await page.locator('#name').fill('Selfie Teste');await page.locator('#email').fill(`camera-${Date.now()}@example.test`);
  await page.locator('#selfie-ai-acknowledged').check();
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/check-in')&&r.request().method()==='POST');
 await page.locator('#submit').click();const response=await responsePromise;expect(response.status()).toBe(201);
 expect(errors).toEqual([]);
 await page.goto('/check-in?new=1');
 await page.locator('#camera').click();await expect(page.locator('#take-photo')).toBeEnabled();
 await page.locator('#cancel-camera').click();await expect(page.locator('#camera-preview')).toBeHidden();
 expect(await page.evaluate(()=>window.cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 const chooser=page.waitForEvent('filechooser');await page.locator('label[for="photo"]').click();await chooser;
 expect(pickers).toBe(1);
});

test('denied camera permission reports error without opening a picker; cancelled late requests release stream',async({page})=>{
 await page.goto('/check-in');let pickers=0;page.on('filechooser',()=>pickers++);
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
 await page.locator('#camera').click();await expect(page.locator('#error')).toContainText('Permita o acesso');
 expect(pickers).toBe(0);await expect(page.locator('#camera')).toBeEnabled();
 await page.evaluate(()=>{
  window.stoppedLateCamera=false;
  navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.resolveCamera=()=>resolve({getTracks:()=>[{stop(){window.stoppedLateCamera=true;}}]});});
 });
 await page.locator('#camera').click();await page.locator('#cancel-camera').click();
 await page.evaluate(()=>window.resolveCamera());
 await expect.poll(()=>page.evaluate(()=>window.stoppedLateCamera)).toBe(true);
 await expect(page.locator('#camera-preview')).toBeHidden();
});
