const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createPortraitProvider,portraitProviderConfig}=require('../lib/portraitProvider');
const {openRouterPortraitConfig}=require('../lib/openRouterPortrait');
const {PORTRAIT_PROMPT}=require('../lib/cloudflarePortrait');
const {createOperationEvents}=require('../lib/operationEvents');
const base={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'secret-cf',OPENROUTER_API_KEY:'secret-or'};
async function setup(t,env={},responses={}){
 await fs.mkdir('.test-data',{recursive:true});const dir=await fs.mkdtemp(path.resolve('.test-data/providers-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const photo=path.join(dir,'selfie.png'),input=await sharp({create:{width:80,height:100,channels:3,background:'#D9D9D9'}}).png().toBuffer();await fs.writeFile(photo,input);
 const calls=[],logs=[],events=createOperationEvents();
 const generate=createPortraitProvider({env:{...base,...env},logger:(event,details)=>{logs.push({event,details});events.record(event,details);},fetchImpl:async(url,options)=>{
  const name=url.includes('api.cloudflare.com')?'cloudflare':'openrouter';calls.push({name,url,options});
  if(responses[name])return responses[name](options);
  return Response.json(name==='cloudflare'?{success:true,result:{image:input.toString('base64')}}:{data:[{b64_json:input.toString('base64')}],usage:{cost:0.012}});
 }});
 return {generate,photo,input,calls,logs,events};
}
const http=status=>async()=>Response.json({error:{message:'PRIVATE RAW ERROR'}},{status});
test('portrait uses its dedicated key; an explicit empty key never charges the shared key',async t=>{
 const r=await setup(t,{PORTRAIT_PROVIDER:'openrouter',OPENROUTER_PORTRAIT_API_KEY:'secret-portrait'});
 await r.generate(r.photo);assert.equal(r.calls[0].options.headers.Authorization,'Bearer secret-portrait');
 assert.doesNotMatch(JSON.stringify(r.logs),/secret-portrait|secret-or/);
 assert.equal(openRouterPortraitConfig(base).apiKey,'secret-or');
 const empty=await setup(t,{PORTRAIT_PROVIDER:'openrouter',OPENROUTER_PORTRAIT_API_KEY:''});
 await assert.rejects(empty.generate(empty.photo),{code:'PORTRAIT_NOT_CONFIGURED'});assert.equal(empty.calls.length,0);
 const {openRouterConfig}=require('../lib/openRouterAvatarAnalyzer');
 assert.equal(openRouterConfig({...base,OPENROUTER_PORTRAIT_API_KEY:'secret-portrait'}).apiKey,'secret-or');
});
for(const provider of ['cloudflare','openrouter']){
 const other=provider==='cloudflare'?'openrouter':'cloudflare';
 test(`${provider} exclusive uses only selected API, preserves source/prompt and returns PNG 512x512`,async t=>{
  const r=await setup(t,{PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'false',PORTRAIT_FALLBACK_PROVIDER:'ignored-invalid'});
  const result=await r.generate(r.photo),meta=await sharp(result).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,512);assert.equal(meta.height,512);
  assert.deepEqual(r.calls.map(c=>c.name),[provider]);
  const request=r.calls[0];
  if(provider==='openrouter'){
   const body=JSON.parse(request.options.body);assert.equal(request.url,'https://openrouter.ai/api/v1/images');assert.equal(request.options.headers.Authorization,'Bearer secret-or');
   assert.equal(body.model,'black-forest-labs/flux-3-image-klein');assert.equal(body.prompt,PORTRAIT_PROMPT);assert.equal(body.aspect_ratio,'1:1');
   assert.equal(body.input_references[0].image_url.url,'data:image/png;base64,'+r.input.toString('base64'));
   assert.equal(r.events.service('OpenRouter').lastCost,0.012);assert.equal(r.events.service('Cloudflare').lastAttempt,undefined);
  }
  assert.doesNotMatch(JSON.stringify(r.logs),/secret-|base64|PRIVATE|selfie\.png/);
 });
 test(`${provider} success never calls configured fallback`,async t=>{
  const r=await setup(t,{PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:other});await r.generate(r.photo);assert.deepEqual(r.calls.map(c=>c.name),[provider]);
 });
 for(const status of [402,408,429,500,503,599])test(`${provider} HTTP ${status} falls back once`,async t=>{
  const r=await setup(t,{PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:other},{[provider]:http(status)});
  await r.generate(r.photo);assert.deepEqual(r.calls.map(c=>c.name),[provider,other]);assert.equal(r.logs.filter(l=>l.event==='portrait:fallback').length,1);
 });
 for(const status of [400,401,403,404,422])test(`${provider} HTTP ${status} does not fall back`,async t=>{
  const r=await setup(t,{PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:other},{[provider]:http(status)});
  await assert.rejects(r.generate(r.photo),e=>e.status===status&&e.retryable===false);assert.deepEqual(r.calls.map(c=>c.name),[provider]);
 });
 test(`${provider} failure with fallback disabled never calls alternate`,async t=>{
  const r=await setup(t,{PORTRAIT_PROVIDER:provider},{[provider]:http(429)});await assert.rejects(r.generate(r.photo));assert.deepEqual(r.calls.map(c=>c.name),[provider]);
 });
 test(`${provider} real abort signal timeout falls back; parent cancellation does not`,async t=>{
  const timeout=options=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});});
  const env={PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:other,CLOUDFLARE_PORTRAIT_TIMEOUT_MS:'10',OPENROUTER_PORTRAIT_TIMEOUT_MS:'10'};
  const r=await setup(t,env,{[provider]:timeout});await r.generate(r.photo);assert.deepEqual(r.calls.map(c=>c.name),[provider,other]);assert.equal(r.logs.find(l=>l.event==='portrait:fallback').details.code,'PORTRAIT_TIMEOUT');
  const controller=new AbortController(),cancel=await setup(t,env,{[provider]:options=>{controller.abort();return Promise.reject(options.signal.reason);}});
  await assert.rejects(cancel.generate(cancel.photo,{signal:controller.signal}));assert.deepEqual(cancel.calls.map(c=>c.name),[provider]);
 });
 test(`${provider} transient network falls back but TLS failure does not`,async t=>{
  for(const code of ['ECONNRESET','SELF_SIGNED_CERT_IN_CHAIN']){
   const r=await setup(t,{PORTRAIT_PROVIDER:provider,PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:other},{[provider]:async()=>{throw Object.assign(new TypeError('PRIVATE RAW'),{cause:{code}});}});
   if(code==='ECONNRESET'){await r.generate(r.photo);assert.equal(r.calls.length,2);}else{await assert.rejects(r.generate(r.photo));assert.equal(r.calls.length,1);}
  }
 });
}
test('both providers failing returns safe final error without looping',async t=>{
 const r=await setup(t,{PORTRAIT_FALLBACK_ENABLED:'true'},{cloudflare:http(429),openrouter:http(503)});
 await assert.rejects(r.generate(r.photo),e=>e.code==='PORTRAIT_HTTP_ERROR'&&e.status===503&&e.retryable===false);assert.deepEqual(r.calls.map(c=>c.name),['cloudflare','openrouter']);
 assert.doesNotMatch(JSON.stringify(r.logs),/PRIVATE RAW/);
});
test('configuration defaults, strict validation and ignored disabled fallback',()=>{
 assert.deepEqual(portraitProviderConfig({}),{provider:'cloudflare',fallbackProvider:null});
 for(const env of [{PORTRAIT_PROVIDER:''},{PORTRAIT_PROVIDER:'invalid'},{PORTRAIT_FALLBACK_ENABLED:'1'},{PORTRAIT_FALLBACK_ENABLED:'TRUE'},{PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'bad'},{PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'cloudflare'}])assert.throws(()=>portraitProviderConfig(env),/PORTRAIT_/);
 assert.equal(portraitProviderConfig({PORTRAIT_FALLBACK_PROVIDER:'bad'}).fallbackProvider,null);
 for(const value of ['0','-1','abc','600001',''])assert.throws(()=>openRouterPortraitConfig({OPENROUTER_PORTRAIT_TIMEOUT_MS:value}),/OPENROUTER_PORTRAIT_TIMEOUT_MS/);
 assert.doesNotThrow(()=>createPortraitProvider({env:{OPENROUTER_PORTRAIT_TIMEOUT_MS:'bad'}}));
});
test('OpenRouter respects actual JPEG MIME and rejects invalid image without API or fallback',async t=>{
 const r=await setup(t,{PORTRAIT_PROVIDER:'openrouter',PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'cloudflare'});
 const jpeg=await sharp(r.input).jpeg().toBuffer();await fs.writeFile(r.photo,jpeg);await r.generate(r.photo);
 assert.equal(JSON.parse(r.calls[0].options.body).input_references[0].image_url.url,'data:image/jpeg;base64,'+jpeg.toString('base64'));
 r.calls.length=0;await fs.writeFile(r.photo,'bad image');await assert.rejects(r.generate(r.photo),{code:'PORTRAIT_INVALID_IMAGE'});assert.equal(r.calls.length,0);
});
test('OpenRouter validates its own envelope and image bytes without fallback',async t=>{
 for(const body of [{result:{image:'AAAA'}},{data:[]},{data:[{b64_json:'bad!'}]},{data:[{b64_json:Buffer.from('not image').toString('base64')}]},{error:{code:401,message:'PRIVATE'}}]){
  const r=await setup(t,{PORTRAIT_PROVIDER:'openrouter',PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'cloudflare'},{openrouter:async()=>Response.json(body)});
  await assert.rejects(r.generate(r.photo));assert.equal(r.calls.length,1);
 }
});
test('Cloudflare permits configured 9b while preserving 4b default',async t=>{
 const r=await setup(t,{CLOUDFLARE_PORTRAIT_MODEL:'@cf/black-forest-labs/flux-2-klein-9b'});await r.generate(r.photo);assert.match(r.calls[0].url,/flux-2-klein-9b$/);
});
test('missing selected credentials never falls back',async t=>{
 const r=await setup(t,{OPENROUTER_API_KEY:'',PORTRAIT_PROVIDER:'openrouter',PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'cloudflare'});await assert.rejects(r.generate(r.photo),{code:'PORTRAIT_NOT_CONFIGURED'});assert.equal(r.calls.length,0);
});
test('Cloudflare explicit quota envelope triggers fallback and logs only numeric cost',async t=>{
 const r=await setup(t,{PORTRAIT_FALLBACK_ENABLED:'true'},{cloudflare:async()=>Response.json({success:false,errors:[{code:3036,message:'PRIVATE'}],usage:{cost:0.001}})});
 await r.generate(r.photo);assert.deepEqual(r.calls.map(c=>c.name),['cloudflare','openrouter']);
 assert.equal(r.logs.find(l=>l.event==='portrait:provider-failed').details.cost,0.001);assert.doesNotMatch(JSON.stringify(r.logs),/PRIVATE/);
 assert.equal(r.events.service('Cloudflare').sessionCost,0.001);assert.equal(r.events.service('OpenRouter').sessionCost,0.012);
});
test('network interruption while reading response triggers fallback',async t=>{
 const r=await setup(t,{PORTRAIT_FALLBACK_ENABLED:'true'},{cloudflare:async()=>({ok:true,json:async()=>{throw Object.assign(Error('PRIVATE'),{cause:{code:'UND_ERR_SOCKET'}});}})});
 await r.generate(r.photo);assert.deepEqual(r.calls.map(c=>c.name),['cloudflare','openrouter']);
});
test('invalid selection rejects application startup before opening storage',async()=>{
 const {createApplication}=require('../server'),previous=process.env.PORTRAIT_PROVIDER;
 try{process.env.PORTRAIT_PROVIDER='invalid';await assert.rejects(createApplication(),/PORTRAIT_PROVIDER/);}
 finally{if(previous===undefined)delete process.env.PORTRAIT_PROVIDER;else process.env.PORTRAIT_PROVIDER=previous;}
 assert.throws(()=>portraitProviderConfig({PORTRAIT_PROVIDER:'openrouter',PORTRAIT_FALLBACK_ENABLED:'true',PORTRAIT_FALLBACK_PROVIDER:'openrouter'}),/diferentes/);
});
