const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fork}=require('node:child_process');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const sharp=require('sharp');
const {createApplication}=require('./helpers/authenticatedApplication');
const {AVATAR_CATALOG,DEFAULT_AVATAR,validateAppearance,avatarSchema}=require('../lib/avatarCatalog');
const {createGeminiAvatarAnalyzer,geminiConfig}=require('../lib/geminiAvatarAnalyzer');
const {createOllamaAvatarAnalyzer,ollamaConfig}=require('../lib/ollamaAvatarAnalyzer');
const {createOpenRouterAvatarAnalyzer,openRouterConfig}=require('../lib/openRouterAvatarAnalyzer');
const {createCloudflarePortrait,MODEL}=require('../lib/cloudflarePortrait');
const {composeAvatar}=require('../lib/lpcAvatarBuilder');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function temp(){const root=path.resolve('.test-data');await fs.mkdir(root,{recursive:true});return fs.mkdtemp(path.join(root,'pipeline-'));}
async function photo(color='#aabbcc'){return sharp({create:{width:64,height:64,channels:3,background:color}}).png().toBuffer();}
async function runtime(options={}){
 const dataDir=options.dataDir||await temp();const r=await createApplication({logger:()=>{},entryDelayMs:0,entrySpacingMs:0,...options,dataDir});
 r.server.listen(0);await new Promise(resolve=>r.server.once('listening',resolve));
 return {...r,dataDir,base:`http://localhost:${r.server.address().port}`};
}
async function checkin(r,index=0,color,expectedStatus=201){
 const form=new FormData();form.set('selfieAiAcknowledged','true');form.set('name','Lucas');form.set('email',`lucas-${index}@example.test`);
 form.set('selfie',new Blob([await photo(color)],{type:'image/png'}),'selfie.png');
 const response=await fetch(r.base+'/api/check-in',{method:'POST',body:form});assert.equal(response.status,expectedStatus);
 const body=await response.json();return {...body.participant,reviewToken:body.reviewToken};
}
async function settled(r){await delay(20);await r.avatarPipeline.idle();}

const openRouterResponse=()=>Response.json({choices:[{message:{content:JSON.stringify({...DEFAULT_AVATAR,hairStyle:'long',glasses:'thin'})},finish_reason:'stop'}]});
const noPortrait=async()=>{throw Object.assign(Error('PORTRAIT_NOT_CONFIGURED'),{code:'PORTRAIT_NOT_CONFIGURED'});};
function temporaryEnv(t,values){
 const original=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(values))process.env[key]=value;
 t.after(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
}

test('OpenRouter server selects its real factory/config, retains DI and concurrency, reuses READY after restart, and regeneration stays local',async t=>{
 temporaryEnv(t,{AVATAR_PROVIDER:'gemini',GEMINI_MODEL:'must-not-be-used',OPENROUTER_API_KEY:'synthetic-openrouter-key',
  OPENROUTER_AVATAR_MODEL:'qwen/qwen3-vl-30b-a3b-instruct',OPENROUTER_AVATAR_TIMEOUT_MS:'30000'});
 const nativeFetch=globalThis.fetch,logs=[];let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url)!=='https://openrouter.ai/api/v1/chat/completions')return nativeFetch(url,options);
  calls++;assert.equal(JSON.parse(options.body).model,'qwen/qwen3-vl-30b-a3b-instruct');
  assert.equal(options.headers.Authorization,'Bearer synthetic-openrouter-key');return openRouterResponse();
 });
 let r=await runtime({avatarProvider:'openrouter',generatePortrait:noPortrait,logger:(event,details)=>logs.push({event,details})});
 try{
  const configured=logs.find(l=>l.event==='avatar:provider-configured').details;
  assert.deepEqual(configured,{provider:'openrouter',model:'qwen/qwen3-vl-30b-a3b-instruct',keyConfigured:true,timeoutMs:30000});
  assert.equal(r.avatarPipeline.stats.concurrency,2);
  const session=await checkin(r,710);await settled(r);let p=r.store.findByUuid(session.uuid);
  assert.equal(calls,1);assert.equal(p.avatarStatus,'READY');assert.equal(p.appearance.hairStyle,'long');assert.equal(p.appearance.glasses,'thin');
  assert.equal(p.avatarKind,'lpc');assert.equal(p.experienceStatus,'AVATAR_REVIEW');assert.equal(r.walkers.size,0);
  const meta=await sharp(Buffer.from(await (await fetch(r.base+p.avatar)).arrayBuffer())).metadata();
  assert.equal(meta.width,576);assert.equal(meta.height,256);
  const publicConfig=await (await fetch(r.base+'/api/operation/config')).json();assert.equal(publicConfig.avatarProvider,'openrouter');
  assert.ok(!JSON.stringify(publicConfig).includes('synthetic-openrouter-key'));
  const before=p.appearance;
  const regenerated=await fetch(`${r.base}/api/participants/${p.uuid}/regenerate-avatar`,{method:'POST',headers:{Authorization:`Bearer ${session.reviewToken}`}});
  assert.equal(regenerated.status,200);await settled(r);p=r.store.findByUuid(p.uuid);
  assert.equal(p.avatarStatus,'READY');assert.equal(p.avatarVersions,2);assert.equal(p.avatarAttempts,1);assert.equal(calls,1);
  assert.notDeepEqual(p.appearance,before);
  const version=p.avatarVersion,dataDir=r.dataDir;await r.close();
  r=await runtime({dataDir,avatarProvider:'openrouter',generatePortrait:noPortrait});await settled(r);
  assert.equal(r.store.findByUuid(p.uuid).avatarVersion,version);assert.equal(calls,1);
  await checkin(r,710,undefined,200);await settled(r);assert.equal(calls,1);
 }finally{await r.close();}
});

test('OpenRouter pipeline retries only 500/502/503/504, persists attempts, and retains bounded errors/fallback',async t=>{
 for(const status of [401,403,429,500,502,503,504])await t.test(String(status),async()=>{
  let calls=0;const logs=[];
  const analyze=createOpenRouterAvatarAnalyzer({config:openRouterConfig({OPENROUTER_API_KEY:'synthetic-key'}),logger:()=>{},fetchImpl:async()=>{
   calls++;if(calls===2)return openRouterResponse();return new Response('PRIVATE RESPONSE',{status});
  }});
  const r=await runtime({avatarProvider:'openrouter',analyzeSelfie:analyze,generatePortrait:noPortrait,logger:(event,details)=>logs.push({event,details})});
  try{
   const p=await checkin(r,status);await settled(r);const saved=r.store.findByUuid(p.uuid),retried=[500,502,503,504].includes(status);
   assert.equal(calls,retried?2:1);assert.equal(saved.avatarAttempts,calls);assert.equal(saved.avatarStatus,retried?'READY':'FALLBACK');
   assert.equal(saved.experienceStatus,'AVATAR_REVIEW');assert.equal(logs.filter(l=>l.event==='avatar:analysis-retrying').length,retried?1:0);
   if(!retried)assert.equal(logs.find(l=>l.event==='avatar:fallback-used').details.code,status===429?'OPENROUTER_QUOTA':'OPENROUTER_AUTH_ERROR');
   assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  }finally{await r.close();}
 });
 let calls=0;const logs=[];
 const r=await runtime({avatarProvider:'openrouter',generatePortrait:noPortrait,logger:(event,details)=>logs.push({event,details}),
  analyzeSelfie:createOpenRouterAvatarAnalyzer({config:openRouterConfig({OPENROUTER_API_KEY:'synthetic-key'}),logger:()=>{},fetchImpl:async()=>{
   calls++;return new Response('PRIVATE RESPONSE',{status:503});
  }})});
 try{
  const p=await checkin(r,799);await settled(r);assert.equal(calls,2);assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'FALLBACK');
  assert.equal(r.store.retryAvatar(p.uuid),false);assert.equal(logs.find(l=>l.event==='avatar:fallback-used').details.code,'OPENROUTER_UNAVAILABLE');
 }finally{await r.close();}
});

test('OpenRouter server uses its own timeout; global deadline includes retry delay and HTTP abort leaves server healthy',async t=>{
 temporaryEnv(t,{OPENROUTER_API_KEY:'synthetic-key',OPENROUTER_AVATAR_TIMEOUT_MS:'80',GEMINI_TIMEOUT_MS:'0'});
 const nativeFetch=globalThis.fetch;let currentMode='hanging',calls=0,aborted=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url)!=='https://openrouter.ai/api/v1/chat/completions')return nativeFetch(url,options);
  calls++;
  if(currentMode==='retry-delay')return new Response('unavailable',{status:503});
  return new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>{aborted++;reject(options.signal.reason);},{once:true});});
 });
 for(const mode of ['hanging','retry-delay']){
  currentMode=mode;calls=0;const logs=[];
  const r=await runtime({avatarProvider:'openrouter',generatePortrait:noPortrait,logger:(event,details)=>logs.push({event,details})});
  try{
   assert.equal(logs.find(l=>l.event==='avatar:provider-configured').details.timeoutMs,80);
   const p=await checkin(r,801);await settled(r);
   assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'FALLBACK');assert.equal(calls,1);
   assert.equal(logs.find(l=>l.event==='avatar:fallback-used').details.code,'OPENROUTER_TIMEOUT');
   assert.equal((await fetch(r.base+'/api/operation/config')).status,200);
  }finally{await r.close();}
 }
 assert.equal(aborted,1);
});

test('OpenRouter controlled parsing/network failures preserve the provisional LPC and review',async t=>{
 const cases=[
  ['envelope',async()=>Response.json({choices:[]}),'OPENROUTER_INVALID_RESPONSE'],
  ['JSON',async()=>Response.json({choices:[{message:{content:'PRIVATE INVALID JSON'},finish_reason:'stop'}]}),'INVALID_JSON'],
  ['appearance',async()=>Response.json({choices:[{message:{content:JSON.stringify({...DEFAULT_AVATAR,top:'PRIVATE'})},finish_reason:'stop'}]}),'INVALID_APPEARANCE'],
  ['truncated',async()=>Response.json({choices:[{message:{content:JSON.stringify(DEFAULT_AVATAR)},finish_reason:'length'}]}),'OPENROUTER_TRUNCATED'],
  ['refused',async()=>Response.json({choices:[{message:{refusal:'PRIVATE'},finish_reason:'stop'}]}),'OPENROUTER_REFUSED'],
  ['network',async()=>{throw Error('PRIVATE NETWORK');},'OPENROUTER_UNAVAILABLE']
 ];
 for(const [name,fetchImpl,code] of cases)await t.test(name,async()=>{
  let calls=0;const logs=[];
  const analyze=createOpenRouterAvatarAnalyzer({config:openRouterConfig({OPENROUTER_API_KEY:'synthetic-key'}),logger:()=>{},fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
  const r=await runtime({avatarProvider:'openrouter',analyzeSelfie:analyze,generatePortrait:noPortrait,logger:(event,details)=>logs.push({event,details})});
  try{
   const p=await checkin(r,810);await settled(r);const saved=r.store.findByUuid(p.uuid);
   assert.equal(saved.avatarStatus,'FALLBACK');assert.equal(saved.avatar,p.avatarUrl);assert.equal(saved.experienceStatus,'AVATAR_REVIEW');
   assert.equal(calls,1);assert.equal(logs.find(l=>l.event==='avatar:fallback-used').details.code,code);
  }finally{await r.close();}
 });
});

test('OpenRouter and actual Cloudflare adapters run in parallel and fail independently',async t=>{
 for(const [lpcOK,portraitOK] of [[true,true],[false,true],[true,false]])await t.test(`LPC ${lpcOK}, portrait ${portraitOK}`,async()=>{
  const lpcStarted=Promise.withResolvers(),portraitStarted=Promise.withResolvers(),release=Promise.withResolvers();
  let lpcCalls=0,portraitCalls=0;const png=await photo();
  const analyze=createOpenRouterAvatarAnalyzer({config:openRouterConfig({OPENROUTER_API_KEY:'synthetic-key'}),logger:()=>{},fetchImpl:async()=>{
   lpcCalls++;lpcStarted.resolve();await release.promise;return lpcOK?openRouterResponse():new Response('unauthorized',{status:401});
  }});
  const portrait=createCloudflarePortrait({config:{accountId:'a'.repeat(32),token:'synthetic-cf-key',model:MODEL,timeoutMs:5000},fetchImpl:async(url,options)=>{
   assert.match(url,/api.cloudflare.com/);assert.equal(options.body.get('width'),'512');
   portraitCalls++;portraitStarted.resolve();await release.promise;
   return portraitOK?Response.json({success:true,result:{image:png.toString('base64')}}):new Response('unauthorized',{status:401});
  }});
  const r=await runtime({avatarProvider:'openrouter',analyzeSelfie:analyze,generatePortrait:portrait});
  try{
   const p=await checkin(r,820);await Promise.all([lpcStarted.promise,portraitStarted.promise]);
   assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'PENDING');assert.equal(r.store.findByUuid(p.uuid).portraitStatus,'PROCESSING');
   release.resolve();await settled(r);await r.passService.idle();const saved=r.store.findByUuid(p.uuid);
   assert.equal(saved.avatarStatus,lpcOK?'READY':'FALLBACK');assert.equal(saved.portraitStatus,portraitOK?'READY':'FAILED');
   assert.equal(saved.experienceStatus,'AVATAR_REVIEW');assert.equal(lpcCalls,1);assert.equal(portraitCalls,1);
  }finally{release.resolve();await r.close();}
 });
});

test('OpenRouter queue limits five concurrent check-ins to two HTTP calls and deduplicates UUID jobs',async()=>{
 const release=Promise.withResolvers(),twoStarted=Promise.withResolvers();let calls=0,active=0,max=0;
 const analyze=createOpenRouterAvatarAnalyzer({config:openRouterConfig({OPENROUTER_API_KEY:'synthetic-key'}),logger:()=>{},fetchImpl:async()=>{
  calls++;active++;max=Math.max(max,active);if(active===2)twoStarted.resolve();
  try{await release.promise;return openRouterResponse();}finally{active--;}
 }});
 const r=await runtime({avatarProvider:'openrouter',analyzeSelfie:analyze,generatePortrait:noPortrait});
 try{
  const participants=await Promise.all(Array.from({length:5},(_,i)=>checkin(r,900+i)));
  await twoStarted.promise;assert.equal(calls,2);assert.equal(r.avatarPipeline.stats.queued,3);
  for(const p of participants)r.avatarPipeline.enqueue(p.uuid);
  assert.equal(r.avatarPipeline.stats.queued,3);release.resolve();await settled(r);
  assert.equal(calls,5);assert.equal(max,2);assert.equal(new Set(participants.map(p=>p.uuid)).size,5);
  for(const p of participants)assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'READY');
 }finally{release.resolve();await r.close();}
});

test('maintenance script explicitly handles all providers, reuses READY and makes local mode a no-op',async()=>{
 const r=await runtime({avatarProvider:'local',analyzeSelfie:async()=>DEFAULT_AVATAR,generatePortrait:noPortrait});
 let session;
 try{session=await checkin(r,950);await settled(r);assert.equal(r.store.findByUuid(session.uuid).avatarStatus,'READY');}
 finally{await r.close();}
 for(const provider of ['local','ollama','gemini','openrouter']){
  const env={...process.env,DATA_DIR:r.dataDir,AVATAR_PROVIDER:provider,GEMINI_API_KEY:'',OPENROUTER_API_KEY:''};
  const {stdout}=await execFile(process.execPath,['scripts/analyze-participant.js',session.uuid],{env,timeout:15000});
  assert.match(stdout,provider==='local'?/local:/:/READY: reusing/);assert.doesNotMatch(stdout,/\[OpenRouter\] request|Requisição/);
 }
 await assert.rejects(execFile(process.execPath,['scripts/analyze-participant.js',session.uuid],{
  env:{...process.env,DATA_DIR:r.dataDir,AVATAR_PROVIDER:'invalid-provider'},timeout:15000
 }),error=>error.code===1&&error.stderr.includes('Use AVATAR_PROVIDER=local, gemini, ollama ou openrouter.'));
});

test('closed catalog, unknown/defaults, hostile values and every mapped shape composes from real assets',async()=>{
 const schema=avatarSchema();assert.deepEqual(schema.required,Object.keys(AVATAR_CATALOG));
 const unknown=Object.fromEntries(Object.keys(AVATAR_CATALOG).map(key=>[key,'unknown']));
 assert.deepEqual(validateAppearance(unknown,{strict:true}).appearance,DEFAULT_AVATAR);
 assert.throws(()=>validateAppearance({...DEFAULT_AVATAR,hairStyle:'../../secret'},{strict:true}),/Invalid/);
 assert.throws(()=>validateAppearance({...DEFAULT_AVATAR,ethnicity:'not allowed'},{strict:true}),/Invalid/);
 const results=new Map();
 for(const key of ['hairStyle','facialHair','glasses','top','bottom'])for(const value of AVATAR_CATALOG[key].filter(v=>v!=='unknown')){
  const buffer=await composeAvatar({...DEFAULT_AVATAR,[key]:value}),meta=await sharp(buffer).metadata();
  assert.equal(meta.width,576);assert.equal(meta.height,256);assert.equal(meta.hasAlpha,true);
  results.set(`${key}:${value}`,buffer);
 }
 assert.notDeepEqual(results.get('hairStyle:bald'),results.get('hairStyle:long'));
 assert.notDeepEqual(results.get('top:tshirt'),results.get('top:jacket'));
 const manifest=JSON.parse(await fs.readFile('public/assets/avatars/lpc/sources/options-manifest.json'));
 for(const layer of manifest.layers){assert.ok(layer.authors.length);assert.ok(layer.licenses.includes(layer.license));}
});

test('Gemini SDK structured request contains only normalized image and catalog; model/timeout configurable',async()=>{
 const dir=await temp(),filename=path.join(dir,'private-identity-never-sent.jpg');
 await sharp({create:{width:1800,height:900,channels:3,background:'#dcb18b'}}).jpeg().withMetadata({orientation:6}).toFile(filename);
 let calls=0,request;
 const {GoogleGenAI}=await import('@google/genai');
 const client=new GoogleGenAI({apiKey:'synthetic-test-key',httpOptions:{fetch:async(_url,init)=>{
  calls++;request=JSON.parse(init.body);
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({...DEFAULT_AVATAR,bottom:'unknown',bottomColor:'unknown',shoes:'unknown'})}]},finishReason:'STOP'}]}),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 const logs=[];
 const analyze=createGeminiAvatarAnalyzer({client,config:{model:'configured-model',timeoutMs:5000,logResponse:true},logger:message=>logs.push(message)});
 const result=await analyze(filename);assert.deepEqual(result,DEFAULT_AVATAR);assert.equal(calls,1);
 const part=request.contents[0].parts.find(p=>p.inlineData),meta=await sharp(Buffer.from(part.inlineData.data,'base64')).metadata();
 assert.equal(meta.width,384);assert.equal(meta.height,768);assert.equal(meta.orientation,undefined);
 assert.equal(part.inlineData.mimeType,'image/jpeg');assert.equal(request.generationConfig.responseMimeType,'application/json');
 assert.deepEqual(request.generationConfig.responseJsonSchema.required,Object.keys(AVATAR_CATALOG));
 assert.ok(!JSON.stringify(request).includes('private-identity-never-sent'));
 assert.equal(geminiConfig({GEMINI_MODEL:'my-model'}).model,'my-model');
 assert.equal(logs.filter(l=>l.includes('"bottom": "unknown"')).length,1);
 assert.ok(logs.some(l=>l.includes('configured-model')));
 assert.ok(!logs.join('\n').includes('synthetic-test-key'));assert.ok(!logs.join('\n').includes('private-identity-never-sent'));
 assert.equal(geminiConfig({NODE_ENV:'production'}).logResponse,false);
 assert.equal(geminiConfig({GEMINI_LOG_RESPONSE:'false'}).logResponse,false);
});

test('configurable Gemini timeout: zero waits for a delayed response and keeps review pending without an automatic fallback',async()=>{
 assert.equal(geminiConfig({}).timeoutMs,180000);
 assert.equal(geminiConfig({GEMINI_TIMEOUT_MS:'0'}).timeoutMs,0);
 assert.equal(geminiConfig({GEMINI_TIMEOUT_MS:'120000'}).timeoutMs,120000);
 for(const value of ['','-1','invalid','Infinity','2147483648'])assert.equal(geminiConfig({GEMINI_TIMEOUT_MS:value}).timeoutMs,180000);
 let release,request;const gate=new Promise(resolve=>{release=resolve;});const logs=[];
 const analyze=createGeminiAvatarAnalyzer({config:{model:'delayed-test-model',timeoutMs:0},logger:message=>logs.push(message),
  client:{models:{generateContent:async options=>{request=options;await gate;return {text:JSON.stringify(DEFAULT_AVATAR)};}}}});
 const r=await runtime({avatarTimeoutMs:0,analyzeSelfie:analyze,logger:(event,details)=>logs.push(JSON.stringify({event,details}))});
 try{
  const p=await checkin(r);await delay(100);
  assert.equal(request.config.httpOptions.timeout,0);assert.equal(request.config.abortSignal.aborted,false);
  assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'PENDING');assert.equal(r.walkers.size,0);
  assert.ok(logs.some(l=>l.includes('avatar:provider-configured')&&l.includes('"timeoutMs":0')));
  release();await settled(r);assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'READY');
  assert.equal(r.store.findByUuid(p.uuid).experienceStatus,'AVATAR_REVIEW');
 }finally{release();await r.close();}
});

test('Ollama sends a normalized image to the local chat endpoint with the shared schema, rejecting invalid output',async()=>{
 const dir=await temp(),filename=path.join(dir,'private-photo.png');
 await sharp({create:{width:1800,height:900,channels:3,background:'#aabbcc'}}).png().toFile(filename);
 let request;const logs=[];
 const config=ollamaConfig({OLLAMA_MODEL:'installed-vision-model',OLLAMA_TIMEOUT_MS:'0'});
 const analyze=createOllamaAvatarAnalyzer({config,logger:message=>logs.push(message),fetchImpl:async(url,options)=>{
  request={url:String(url),options,body:JSON.parse(options.body)};
  return Response.json({message:{content:JSON.stringify({...DEFAULT_AVATAR,bottom:'unknown'})}});
 }});
 assert.deepEqual(await analyze(filename),DEFAULT_AVATAR);
 assert.equal(request.url,'http://127.0.0.1:11434/api/chat');assert.equal(request.body.model,'installed-vision-model');
 assert.equal(request.body.stream,false);assert.equal(request.body.think,false);
 assert.deepEqual(request.body.format,avatarSchema());assert.equal(request.options.signal.aborted,false);
 const metadata=await sharp(Buffer.from(request.body.messages[0].images[0],'base64')).metadata();
 assert.equal(metadata.width,768);assert.equal(metadata.height,384);assert.equal(metadata.format,'jpeg');
 assert.ok(!JSON.stringify(request.body).includes('private-photo'));
 assert.ok(!logs.join('\n').includes(request.body.messages[0].images[0]));
 for(const base of ['https://ollama.com','http://192.168.1.1:11434','http://user:password@localhost:11434'])assert.throws(()=>ollamaConfig({OLLAMA_BASE_URL:base}));
 assert.throws(()=>ollamaConfig({OLLAMA_MODEL:'remote:cloud'}));
 for(const [fetchImpl,code] of [
  [async()=>Response.json({message:{content:'bad-json'}}),'INVALID_JSON'],
  [async()=>Response.json({message:{content:JSON.stringify({...DEFAULT_AVATAR,hairStyle:'../../secret'})}}),'INVALID_APPEARANCE'],
  [async()=>Response.json({error:'PRIVATE ERROR'},{status:404}),'OLLAMA_API_ERROR'],
  [async()=>{throw Error('PRIVATE ERROR');},'OLLAMA_UNAVAILABLE']
 ])await assert.rejects(createOllamaAvatarAnalyzer({config,fetchImpl,logger:()=>{}})(filename),e=>e.code===code&&!e.message.includes('PRIVATE'));
 const waiting=createOllamaAvatarAnalyzer({config:{...config,timeoutMs:10},logger:()=>{},fetchImpl:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))});
 await assert.rejects(waiting(filename),e=>e.code==='OLLAMA_TIMEOUT');
});

test('Ollama provider processes one photo at a time, composes LPC and waits for approval without Google',async()=>{
 let active=0,max=0,calls=0;
 const analyze=createOllamaAvatarAnalyzer({logger:()=>{},fetchImpl:async()=>{
  active++;max=Math.max(max,active);calls++;await delay(50);active--;
  return Response.json({message:{content:JSON.stringify({...DEFAULT_AVATAR,hairStyle:'long'})}});
 }});
 const r=await runtime({avatarProvider:'ollama',analyzeSelfie:analyze});
 try{
  const participants=await Promise.all([checkin(r,201),checkin(r,202)]);await settled(r);
  assert.equal(calls,2);assert.equal(max,1);assert.equal(r.avatarPipeline.stats.concurrency,1);
  assert.equal(r.walkers.size,0);assert.equal((await (await fetch(r.base+'/api/operation/config')).json()).avatarProvider,'ollama');
  for(const p of participants){const saved=r.store.findByUuid(p.uuid);assert.equal(saved.avatarStatus,'READY');assert.equal(saved.experienceStatus,'AVATAR_REVIEW');assert.equal(saved.appearance.hairStyle,'long');}
  await checkin(r,201,undefined,200);assert.equal(calls,2);
 }finally{await r.close();}
});

test('temporary Gemini 503 retries once within the persisted budget; permanent errors and timeout do not loop',async()=>{
 const dir=await temp(),filename=path.join(dir,'test.png');await fs.writeFile(filename,await photo());
 const unavailable=createGeminiAvatarAnalyzer({client:{models:{generateContent:async()=>{throw Object.assign(Error('PRIVATE SDK MESSAGE'),{status:503});}}},config:{model:'test',timeoutMs:1000}});
 await assert.rejects(unavailable(filename),e=>e.code==='GEMINI_UNAVAILABLE'&&e.status===503&&!e.message.includes('PRIVATE'));
 for(const scenario of ['recovered','unavailable','invalid-key','deadline']){
  let calls=0;const logs=[];
  const r=await runtime({avatarTimeoutMs:scenario==='deadline'?80:5000,logger:(event,details)=>logs.push({event,details}),
   analyzeSelfie:async()=>{
    calls++;
    if(scenario==='recovered'&&calls===2)return DEFAULT_AVATAR;
    const status=scenario==='invalid-key'?401:503;
    throw Object.assign(Error('PRIVATE PROVIDER MESSAGE'),{code:status===503?'GEMINI_UNAVAILABLE':'GEMINI_API_ERROR',status});
   }});
  try{
   const p=await checkin(r);await settled(r);const saved=r.store.findByUuid(p.uuid);
   assert.equal(calls,['recovered','unavailable'].includes(scenario)?2:1);
   assert.equal(saved.avatarAttempts,calls);assert.equal(saved.avatarVersions,1);
   assert.equal(saved.avatarStatus,scenario==='recovered'?'READY':'FALLBACK');
   assert.equal(saved.experienceStatus,'AVATAR_REVIEW');assert.equal(r.walkers.size,0);
   assert.equal(logs.filter(l=>l.event==='avatar:analysis-retrying').length,scenario==='invalid-key'?0:1);
   assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
   if(scenario==='unavailable')assert.equal(r.store.retryAvatar(p.uuid),false);
   if(scenario==='deadline')assert.ok(logs.some(l=>l.details?.code==='GEMINI_TIMEOUT'));
  }finally{await r.close();}
 }
});

test('check-in completes while analysis waits; READY persists, UUID identity and no repeated API after restart',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 let r=await runtime({analyzeSelfie:async()=>{calls++;await gate;return {...DEFAULT_AVATAR,hairStyle:'long',glasses:'round'};}});
 const dataDir=r.dataDir;
 try{
  const p=await checkin(r);assert.equal(p.avatarStatus,'PENDING');assert.equal(p.avatarType,'lpc');
  const image=await sharp(Buffer.from(await (await fetch(r.base+p.avatarUrl)).arrayBuffer())).metadata();assert.equal(image.width,576);
  await delay(120);assert.equal(calls,1);assert.equal(r.walkers.has(p.uuid),false);
  assert.equal((await (await fetch(r.base+'/api/world')).json()).participants.length,0);release();await settled(r);
  let saved=r.store.findByUuid(p.uuid);assert.equal(saved.avatarStatus,'READY');assert.equal(saved.appearance.hairStyle,'long');
  assert.notEqual(saved.avatar,p.avatarUrl);assert.equal(r.walkers.has(p.uuid),false);assert.equal(saved.experienceStatus,'AVATAR_REVIEW');
  const json=JSON.stringify(await (await fetch(r.base+'/api/world')).json());
  for(const privateField of ['email','photoPath','appearance','apiKey'])assert.ok(!json.includes(privateField));
  await r.close();r=await runtime({dataDir,analyzeSelfie:async()=>{calls++;throw Error('must not call');}});
  saved=r.store.findByUuid(p.uuid);assert.equal(saved.avatarStatus,'READY');assert.equal(calls,1);
  assert.equal((await fetch(r.base+saved.avatar)).status,200);
 }finally{release();await r.close();}
});

test('invalid key, offline, timeout, missing photo, invalid JSON/catalog and builder failure retain a visible fallback',async()=>{
 const dir=await temp(),filename=path.join(dir,'test.png');await fs.writeFile(filename,await photo());
 const badJson=createGeminiAvatarAnalyzer({client:{models:{generateContent:async()=>({text:'not JSON'})}},config:{model:'test',timeoutMs:1000}});
 const badKey=createGeminiAvatarAnalyzer({client:{models:{generateContent:async()=>{throw Object.assign(Error('PRIVATE KEY MUST NOT LOG'),{status:401});}}},config:{model:'test',timeoutMs:1000}});
 const offline=createGeminiAvatarAnalyzer({client:{models:{generateContent:async()=>{throw Error('offline PRIVATE');}}},config:{model:'test',timeoutMs:1000}});
 const cases=[
  {analyzeSelfie:badKey},{analyzeSelfie:offline},{analyzeSelfie:()=>new Promise(()=>{}),avatarTimeoutMs:40},
  {analyzeSelfie:()=>badJson(filename)},
  {analyzeSelfie:()=>Promise.resolve({...DEFAULT_AVATAR,hairStyle:'invented'})},
  {analyzeSelfie:imagePath=>fs.readFile(imagePath+'.missing')},
  {analyzeSelfie:()=>Promise.resolve(DEFAULT_AVATAR),buildLpcAvatar:()=>{throw Error('builder failure PRIVATE');}},
 ];
 for(const options of cases){
  const logs=[];const r=await runtime({...options,logger:(event,details)=>logs.push({event,details})});
  try{const p=await checkin(r);await settled(r);const stored=r.store.findByUuid(p.uuid);
   assert.equal(stored.avatarStatus,'FALLBACK');assert.equal(stored.avatar,p.avatarUrl);
   assert.equal((await fetch(r.base+stored.avatar)).status,200);assert.equal(r.walkers.has(p.uuid),false);assert.equal(stored.experienceStatus,'AVATAR_REVIEW');
   assert.deepEqual(stored.appearance,DEFAULT_AVATAR);assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  }finally{await r.close();}
 }
});

test('5 then 10 simultaneous check-ins: bounded queue, duplicate names and participant-to-photo isolation',async()=>{
 for(const count of [5,10]){
  let active=0,max=0,calls=0;const associations=new Map();
  const r=await runtime({analyzeSelfie:async imagePath=>{
   calls++;active++;max=Math.max(max,active);await delay(40);
   const {data}=await sharp(imagePath).raw().toBuffer({resolveWithObject:true});
   const appearance={...DEFAULT_AVATAR,hairColor:data[0]>100?'blonde':'black'};
   associations.set(path.basename(imagePath,'.png'),appearance);active--;return appearance;
  }});
  try{
   const participants=await Promise.all(Array.from({length:count},(_,i)=>checkin(r,i,i%2?'#dd0000':'#330000')));
   await settled(r);assert.equal(calls,count);assert.ok(max<=2);assert.equal(max,2);
   assert.equal(new Set(participants.map(p=>p.uuid)).size,count);
   const urls=new Set();for(const p of participants){
    const stored=r.store.findByUuid(p.uuid);assert.equal(stored.avatarStatus,'READY');
    assert.deepEqual(stored.appearance,associations.get(p.uuid));assert.ok(stored.avatar.includes(p.uuid));urls.add(stored.avatar);
   }
   assert.equal(urls.size,count);assert.deepEqual(r.avatarPipeline.stats,{queued:0,running:0,concurrency:2});
  }finally{await r.close();}
 }
});

test('interrupted PENDING is resumed once; local mode stays offline and retry is bounded',async()=>{
 let entered;const begun=new Promise(resolve=>{entered=resolve;});
 let r=await runtime({analyzeSelfie:async(_path,{signal})=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('shutdown')),{once:true}));}});
 const p=await checkin(r),dataDir=r.dataDir;await begun;await r.close();
 let calls=0;r=await runtime({dataDir,analyzeSelfie:async()=>{calls++;return DEFAULT_AVATAR;}});
 try{await settled(r);assert.equal(calls,1);assert.equal(r.store.findByUuid(p.uuid).avatarStatus,'READY');
  assert.equal(r.store.findByUuid(p.uuid).avatarAttempts,2);
 }finally{await r.close();}
 r=await runtime({avatarProvider:'local'});
 try{const offline=await checkin(r);assert.equal(offline.avatarStatus,'FALLBACK');assert.equal(offline.avatarType,'lpc');
  assert.equal(r.store.retryAvatar(offline.uuid),true);r.avatarPipeline.enqueue(offline.uuid);await settled(r);
  assert.equal(r.store.findByUuid(offline.uuid).avatarStatus,'FALLBACK');
 }finally{await r.close();}
});

test('READY survives a real fresh Node process without reanalysis or attempt increment',async()=>{
 const r=await runtime({analyzeSelfie:async()=>({...DEFAULT_AVATAR,facialHair:'full_beard',topColor:'black'})});
 const p=await checkin(r);await settled(r);const ready=r.store.findByUuid(p.uuid),dataDir=r.dataDir;
 await r.close();
 const child=fork(path.resolve('tests/fixtures/server-process.cjs'),[dataDir,'0'],
  {windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,AVATAR_PROVIDER:'local'}});
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Fresh Node startup timeout')),15000);
   child.once('message',message=>{clearTimeout(timer);resolve(message.port);});
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Fresh Node exited'));});
  });
  const response=await (await fetch(`http://localhost:${port}/api/participants/${p.uuid}/avatar-status`,{headers:{Authorization:'Bearer '+p.reviewToken}})).json();
  assert.equal(response.participant.avatarStatus,'READY');assert.equal(response.participant.avatarUrl,ready.avatar);
  const metadata=await sharp(Buffer.from(await (await fetch(`http://localhost:${port}${ready.avatar}`)).arrayBuffer())).metadata();
  assert.equal(metadata.width,576);assert.equal(metadata.height,256);
 }finally{
  if(child.exitCode===null)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Fresh Node shutdown timeout'));},15000);
   child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Fresh Node shutdown failed'));});child.send('shutdown');
  });
 }
 const {createStore}=require('../lib/store'),store=createStore(dataDir);
 try{assert.equal(store.findByUuid(p.uuid).avatarAttempts,1);}finally{store.close();}
});
