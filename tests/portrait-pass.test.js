const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {Readable}=require('node:stream');
const sharp=require('sharp');
const {createApplication,nativeFetch}=require('./helpers/authenticatedApplication');
const {createCloudflarePortrait,PORTRAIT_PROMPT,MODEL}=require('../lib/cloudflarePortrait');
const {createPortraitProvider}=require('../lib/portraitProvider');
const {createStoryRenderer,storyBrowserChannel,storyFailure}=require('../lib/storyRenderer');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(){return sharp(Buffer.from('<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><path fill="#D9D9D9" d="M0 0h512v512H0z"/><path fill="#20323c" d="M168 80h176v48H168zM136 128h240v176H136zM104 368h304v144H104z"/><path fill="#ddb594" d="M168 144h176v176H168zM200 320h112v64H200z"/><path fill="#183038" d="M192 208h32v32h-32zM288 208h32v32h-32z"/><path fill="#487ca1" d="M136 384h240v128H136z"/></svg>')).png().toBuffer();}
async function runtime(options={}){
 await fs.mkdir('.test-data',{recursive:true});const dataDir=options.dataDir||await fs.mkdtemp(path.resolve('.test-data/pass-'));
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:20,entrySpacingMs:0,logger:()=>{},portraitRetryDelayMs:5,...options});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));return {...r,dataDir,base:`http://localhost:${r.server.address().port}`};
}
async function register(r,index=0,name='Lucas Garofolo'){
 const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name',name);form.set('email',`private-${index}@example.test`);form.set('selfie',new Blob([await fixture()],{type:'image/png'}),'private.png');
 const response=await fetch(r.base+'/api/check-in',{method:'POST',body:form});assert.equal(response.status,201);return response.json();
}
const owner=s=>({Authorization:'Bearer '+s.reviewToken});
const approve=(r,s)=>fetch(`${r.base}/api/participants/${s.participant.uuid}/approve-avatar`,{method:'POST',headers:owner(s)});
async function active(r,uuid){for(let i=0;i<70&&r.store.findByUuid(uuid)?.experienceStatus!=='ACTIVE';i++)await pause(50);assert.equal(r.store.findByUuid(uuid).experienceStatus,'ACTIVE');}
const fakeRenderer={render:async(_data,{outputPath})=>fs.writeFile(outputPath,await sharp({create:{width:1080,height:1920,channels:3,background:'#12343a'}}).png().toBuffer()),close:async()=>{}};

test('provider sequence is not retried by queue and READY portrait survives provider switch without API calls',async()=>{
 const pixels=await fixture(),calls=[];
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test',OPENROUTER_API_KEY:'test',PORTRAIT_FALLBACK_ENABLED:'true'};
 let fail=true;
 const generatePortrait=createPortraitProvider({env,fetchImpl:async url=>{calls.push(url);return fail?Response.json({}, {status:503}):Response.json({success:true,result:{image:pixels.toString('base64')}});}});
 let r=await runtime({generatePortrait,storyRenderer:fakeRenderer});const directory=r.dataDir;
 try{
  const abandoned=await register(r,901);await r.passService.idle();assert.equal(calls.length,2);
  assert.equal(r.store.findByUuid(abandoned.participant.uuid).portraitStatus,'FAILED');assert.equal(r.store.findByUuid(abandoned.participant.uuid).portraitAttempts,1);
  fail=false;const ready=await register(r,902);await r.passService.idle();assert.equal(calls.length,3);assert.equal(r.store.findByUuid(ready.participant.uuid).portraitStatus,'READY');
  await r.close();
  const alternate=createPortraitProvider({env:{...env,PORTRAIT_PROVIDER:'openrouter',PORTRAIT_FALLBACK_ENABLED:'false'},fetchImpl:async()=>{calls.push('unexpected');throw Error('must use cache');}});
  r=await runtime({dataDir:directory,generatePortrait:alternate,storyRenderer:fakeRenderer});await r.passService.idle();
  r.passService.request(ready.participant.uuid);await r.passService.idle();assert.equal(calls.length,3);assert.equal(r.store.findByUuid(ready.participant.uuid).portraitStatus,'READY');
 }finally{await r.close();}
});

test('Cloudflare sends the exact prompt and binary multipart with automatic boundary, validates and normalizes result',async()=>{
 assert.match(PORTRAIT_PROMPT,/Preserve eyeglasses only when clearly worn/);assert.match(PORTRAIT_PROMPT,/WITHOUT glasses/);
 const output=await fixture(),directory=await fs.mkdtemp(path.resolve('.test-data/cloudflare-')),photo=path.join(directory,'private.png');await fs.writeFile(photo,output);
 let received;
 const server=http.createServer(async(req,res)=>{
  const request=new Request('http://local-test',{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'});
  const form=await request.formData();received={form,headers:req.headers};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,result:{image:output.toString('base64')}}));
 });
 server.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 try{
  const generate=createCloudflarePortrait({config:{accountId:'a'.repeat(32),token:'private-test-token',model:MODEL,timeoutMs:1000},fetchImpl:(url,options)=>{
   assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/${MODEL}`);
   assert.equal(options.headers['Content-Type'],undefined);return nativeFetch(`http://localhost:${server.address().port}`,options);
  }});
  const png=await generate(photo);assert.equal(received.form.get('prompt').replace(/\r\n/g,'\n'),PORTRAIT_PROMPT);assert.equal(received.form.get('width'),'512');assert.equal(received.form.get('height'),'512');
  assert.deepEqual(Buffer.from(await received.form.get('input_image_0').arrayBuffer()),output);assert.match(received.headers['content-type'],/multipart\/form-data; boundary=/);
  const metadata=await sharp(png).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.equal(metadata.format,'png');
  for(const body of [{success:false,result:{image:output.toString('base64')}},{success:true,result:{}},{success:true,result:{image:'bad!'}},{success:true,result:{image:Buffer.from('not an image').toString('base64')}}]){
   const bad=createCloudflarePortrait({config:{accountId:'a'.repeat(32),token:'private-test-token',model:MODEL,timeoutMs:1000},fetchImpl:async()=>Response.json(body)});
   await assert.rejects(bad(photo),error=>!error.message.includes('private-test-token'));
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Story diagnostics distinguish browser/assets/storage failures without exposing raw Playwright data',()=>{
 assert.equal(storyBrowserChannel({NODE_ENV:'production'}),'chromium');assert.equal(storyBrowserChannel({}),'chrome');
 assert.equal(storyBrowserChannel({NODE_ENV:'production',STORY_BROWSER_CHANNEL:'chrome'}),'chrome');
 const cases=[
  [Error("Executable doesn't exist at /PRIVATE/browser"),'browser_launch','STORY_BROWSER_MISSING'],
  [Error('error while loading shared libraries: PRIVATE.so'),'browser_launch','STORY_BROWSER_DEPENDENCIES'],
  [Error('Target page, context or browser has been closed PRIVATE'),'page_create','STORY_BROWSER_CLOSED'],
  [Object.assign(Error('PRIVATE HTML data:image/png;base64,PRIVATE'),{name:'TimeoutError'}),'html_render','STORY_RENDER_TIMEOUT'],
  [Object.assign(Error('/PRIVATE/avatar.png'),{code:'ENOENT'}),'asset_read','STORY_ASSET_MISSING'],
  [Object.assign(Error('/PRIVATE/story.png'),{code:'ENOSPC'}),'asset_write','STORY_STORAGE_ERROR'],
  [Error('PRIVATE authorization token'),'browser_launch','STORY_BROWSER_LAUNCH_FAILED'],
  [Error('PRIVATE HTML image'),'image_decode','STORY_RENDER_FAILED']
 ];
 for(const [error,stage,code]of cases){const safe=storyFailure(error,stage);assert.equal(safe.code,code);assert.equal(safe.stage,stage);assert.equal(safe.message,code);assert.ok(!JSON.stringify(safe).includes('PRIVATE'));}
});

test('a missing Story browser produces a safe FAILED state; regeneration after recovery works without selfie or new IA',async()=>{
 let fail=true,launches=0,portraitCalls=0,current;const pages=[];
 const browserType={launch:async()=>{launches++;if(fail)throw Error("Executable doesn't exist at /PRIVATE/browser");
  current={connected:true,isConnected(){return this.connected;},close:async()=>{current.connected=false;},newPage:async()=>{const page={closed:false,route:async()=>{},setContent:async()=>{},evaluate:async()=>{},screenshot:async({path:outputPath})=>fakeRenderer.render({}, {outputPath}),close:async()=>{page.closed=true;}};pages.push(page);return page;}};return current;}};
 const renderer=createStoryRenderer({browserType}),logs=[];const r=await runtime({storyRenderer:renderer,logger:(event,details)=>logs.push({event,details}),generatePortrait:async()=>{portraitCalls++;return fixture();}});
 try{const s=await register(r),uuid=s.participant.uuid;await approve(r,s);await r.passService.idle();await r.selfieLifecycle.idle();
  assert.equal(r.store.findByUuid(uuid).storyStatus,'FAILED');assert.equal(r.store.findByUuid(uuid).selfieStatus,'DELETED');
  const error=logs.find(l=>l.event==='story:generation-failed');assert.equal(error.details.code,'STORY_BROWSER_MISSING');assert.equal(error.details.stage,'browser_launch');assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  const failedLaunches=launches;fail=false;assert.equal(r.passService.regenerateStory(uuid),true);await r.passService.idle();assert.equal(r.store.findByUuid(uuid).storyStatus,'READY');assert.equal(portraitCalls,1);assert.equal(launches,failedLaunches+1);
  const data=await(await fetch(r.base+'/api/pass/'+uuid)).json();assert.equal((await fetch(r.base+data.pass.storyUrl)).status,200);assert.ok(pages.every(p=>p.closed));
  current.connected=false;assert.equal(r.passService.regenerateStory(uuid),true);await r.passService.idle();assert.equal(r.store.findByUuid(uuid).storyStatus,'READY');assert.equal(launches,failedLaunches+2);assert.equal(portraitCalls,1);
 }finally{await r.close();}
});

test('approval is independent of portrait; real Story render, public privacy, restart cache and changed profile invalidation',async()=>{
 let release,calls=0,renders=0;const gate=new Promise(resolve=>{release=resolve;});const pixels=await fixture();
 function renderer(){const real=createStoryRenderer();return {render:async(...args)=>{renders++;await real.render(...args);},close:()=>real.close()};}
 let r=await runtime({generatePortrait:async()=>{calls++;await gate;return pixels;},storyRenderer:renderer(),passConfig:{edition:'2026',instagramHandle:'',hashtag:'#MundoDigital',role:'',organization:''}});
 const directory=r.dataDir;
 try{
  const s=await register(r),uuid=s.participant.uuid;const original=r.store.findByUuid(uuid);
  assert.equal((await fetch(r.base+'/api/pass/'+uuid)).status,200);
  assert.equal((await (await fetch(r.base+'/api/pass/'+uuid)).json()).pass.shareAllowed,false);
  await Promise.all([approve(r,s),approve(r,s)]);await active(r,uuid);assert.equal(calls,1);
  let body=await (await fetch(r.base+'/api/pass/'+uuid)).json();assert.equal(body.pass.portraitStatus,'PROCESSING');assert.ok(body.cardHtml.includes('Preparando seu portrait'));
  release();await r.passService.idle();let p=r.store.findByUuid(uuid);
  assert.equal(p.portraitStatus,'READY');assert.equal(p.storyStatus,'READY');assert.equal(p.avatar,original.avatar);assert.equal(p.avatarVersion,original.avatarVersion);assert.equal(p.avatarAttempts,original.avatarAttempts);
  const initialRenders=renders;assert.ok(initialRenders>=1&&initialRenders<=2);
  const story=await fs.readFile(r.passService.paths(uuid).story),meta=await sharp(story).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1920);
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/pass-story.png',story);
  body=await (await fetch(r.base+'/api/pass/'+uuid)).json();
  for(const secret of ['private-0@example.test',s.reviewToken,'photoPath','reviewToken','portraitPath','appearance','apiKey'])assert.ok(!JSON.stringify(body).includes(secret));
  assert.match(body.pass.passNumber,/^MS\d{2}-[A-F0-9]{12}$/);assert.equal(body.pass.lpcAvatarUrl,original.avatar);
  const download=await fetch(r.base+body.pass.storyUrl+'&download=1');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
  await approve(r,s);await r.passService.idle();assert.equal(calls,1);assert.equal(renders,initialRenders);
  const hash=p.storyHash,number=p.passNumber;await r.close();r=await runtime({dataDir:directory,storyRenderer:renderer(),generatePortrait:async()=>{calls++;throw Error('must not generate');},passConfig:{edition:'2026',instagramHandle:'',hashtag:'#MundoDigital',role:'',organization:''}});
  await r.passService.idle();assert.equal(calls,1);assert.equal(renders,initialRenders);assert.equal(r.store.findByUuid(uuid).passNumber,number);
  const profile={role:'Visitante',organization:'Instituição informada',profileTag:'Tecnologia',highlight:'Meu primeiro Mundo // Digital'};
  const response=await fetch(`${r.base}/api/participants/${uuid}/pass-profile`,{method:'PUT',headers:{...owner(s),'Content-Type':'application/json'},body:JSON.stringify(profile)});assert.equal(response.status,200);
  await r.passService.idle();assert.equal(renders,initialRenders+1);assert.notEqual(r.store.findByUuid(uuid).storyHash,hash);assert.equal(calls,1);
  await fetch(`${r.base}/api/participants/${uuid}/pass-profile`,{method:'PUT',headers:{...owner(s),'Content-Type':'application/json'},body:JSON.stringify(profile)});await r.passService.idle();assert.equal(renders,initialRenders+1);
  assert.equal((await fetch(`${r.base}/api/participants/${uuid}/pass-profile`,{method:'PUT',headers:{...owner(s),'Content-Type':'application/json'},body:JSON.stringify({profileTag:'<script>'})})).status,400);
 }finally{release();await r.close();}
});

test('Cloudflare terminal failure respects automatic budget, preserves LPC/entry and requires a new selfie for later retry',async()=>{
 for(const transient of [true,false]){
  let calls=0;const logs=[];const r=await runtime({storyRenderer:fakeRenderer,logger:(event,details)=>logs.push({event,details}),generatePortrait:async()=>{
   calls++;if(!transient&&calls===2)return fixture();throw Object.assign(Error('PRIVATE TOKEN AND BASE64'),{code:'PORTRAIT_HTTP_ERROR',status:transient?503:401});
  }});
  try{
   const s=await register(r),uuid=s.participant.uuid,avatar=s.participant.avatar;
   await approve(r,s);await active(r,uuid);await r.passService.idle();assert.equal(calls,transient?2:1);
   assert.equal(r.store.findByUuid(uuid).portraitStatus,'FAILED');assert.equal(r.store.findByUuid(uuid).avatar,avatar);
   await approve(r,s);await fetch(r.base+'/api/pass/'+uuid);await r.passService.idle();assert.equal(calls,transient?2:1);
   assert.equal((await fetch(`${r.base}/api/participants/${uuid}/retry-portrait`,{method:'POST'})).status,403);
   await r.selfieLifecycle.idle();
   const retry=await fetch(`${r.base}/api/participants/${uuid}/retry-portrait`,{method:'POST',headers:owner(s)});assert.equal(retry.status,409);
   assert.match((await retry.json()).error,/Selfie original removida por privacidade/);
   await r.passService.idle();assert.equal(calls,transient?2:1);
   assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  }finally{await r.close();}
 }
});

test('interrupted portrait resumes within budget; PNG saved before crash is recovered without another Cloudflare call',async()=>{
 let started;const begun=new Promise(resolve=>{started=resolve;});let calls=0;
 let r=await runtime({storyRenderer:fakeRenderer,generatePortrait:async(_photo,{signal})=>{calls++;started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 const s=await register(r),uuid=s.participant.uuid,directory=r.dataDir;await approve(r,s);await begun;await r.close();
 r=await runtime({dataDir:directory,storyRenderer:fakeRenderer,generatePortrait:async()=>{calls++;return fixture();}});
 await r.passService.idle();assert.equal(calls,2);assert.equal(r.store.findByUuid(uuid).portraitStatus,'READY');await r.close();
 const {createStore}=require('../lib/store'),store=createStore(directory);store.db.prepare("UPDATE participants SET portrait_status='PROCESSING',portrait_attempts=2 WHERE uuid=?").run(uuid);store.close();
 r=await runtime({dataDir:directory,storyRenderer:fakeRenderer,generatePortrait:async()=>{calls++;throw Error('must reuse saved PNG');}});
 try{await r.passService.idle();assert.equal(calls,2);assert.equal(r.store.findByUuid(uuid).portraitStatus,'READY');}finally{await r.close();}
});

test('administrative cleanup cancels portraits and removes generated files without recreating deleted participants',async()=>{
 let began;const started=new Promise(resolve=>{began=resolve;});const r=await runtime({storyRenderer:fakeRenderer,generatePortrait:async(_photo,{signal})=>{began();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 try{const s=await register(r);await approve(r,s);await started;
  const response=await fetch(r.base+'/api/participants',{method:'DELETE',headers:{'X-SENAI-ADMIN':'reset-participants'}});assert.equal(response.status,200);
  await r.passService.idle();assert.equal(r.store.list().length,0);assert.equal(r.walkers.size,0);assert.equal((await fetch(r.base+'/pass/'+s.participant.uuid)).status,404);
  assert.equal(await fs.stat(r.passService.paths(s.participant.uuid).directory).then(()=>true).catch(()=>false),false);
 }finally{await r.close();}
});
