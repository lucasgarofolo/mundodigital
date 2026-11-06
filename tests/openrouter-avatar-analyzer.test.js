const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const sharp=require('sharp');
const {createOpenRouterAvatarAnalyzer,openRouterConfig}=require('../lib/openRouterAvatarAnalyzer');
const {avatarPrompt}=require('../lib/geminiAvatarAnalyzer');
const {DEFAULT_AVATAR,avatarSchema,validateAppearance}=require('../lib/avatarCatalog');
const config=openRouterConfig({OPENROUTER_API_KEY:'synthetic-secret-never-log'});
const raw={hairStyle:'short',hairColor:'gray',facialHair:'full_beard',facialHairColor:'gray',glasses:'thin',
 top:'tshirt',topColor:'black',bottom:'unknown',bottomColor:'unknown',shoes:'unknown'};
const envelope=(content=JSON.stringify(raw),finish_reason='stop')=>({choices:[{message:{role:'assistant',content},finish_reason}]});
async function image(){
 await fs.mkdir('.test-data',{recursive:true});const dir=await fs.mkdtemp(path.resolve('.test-data/openrouter-unit-'));
 const filename=path.join(dir,'private-name-email-uuid.png');
 await sharp({create:{width:1800,height:900,channels:4,background:'#bbaacc'}}).png().withMetadata({orientation:6}).toFile(filename);
 return filename;
}
const analyzer=(fetchImpl,options={})=>createOpenRouterAvatarAnalyzer({config,logger:()=>{},fetchImpl,...options});
const bounded=(code,status)=>error=>error.code===code&&error.message===code&&(status===undefined||error.status===status);

test('OpenRouter config has an independent model and 30-second default; overrides and zero follow existing timeout conventions',()=>{
 assert.equal(config.model,'qwen/qwen3-vl-30b-a3b-instruct');assert.equal(config.timeoutMs,30000);
 assert.equal(openRouterConfig({GEMINI_MODEL:'wrong',OLLAMA_MODEL:'wrong'}).model,config.model);
 assert.equal(openRouterConfig({OPENROUTER_AVATAR_MODEL:'explicit-model'}).model,'explicit-model');
 for(const value of ['','-1','invalid','Infinity','2147483648'])assert.equal(openRouterConfig({OPENROUTER_AVATAR_TIMEOUT_MS:value}).timeoutMs,30000);
 for(const value of ['0','50','30000'])assert.equal(openRouterConfig({OPENROUTER_AVATAR_TIMEOUT_MS:value}).timeoutMs,Number(value));
 assert.match(avatarPrompt(),/Se facialHair = none, facialHairColor deve ser unknown\./);
 assert.match(avatarPrompt(),/glasses deve ser none/);
});

test('OpenRouter sends only the shared prompt/schema and normalized private JPEG, returns appearance, and logs accounting safely',async()=>{
 const filename=await image(),logs=[];let calls=0,request;
 const usage={prompt_tokens:1059,completion_tokens:75,total_tokens:1134,cost:0.00020385};
 const analyze=analyzer(async(url,options)=>{
  calls++;request={url,options,body:JSON.parse(options.body)};
  return Response.json({...envelope(),provider:'DeepInfra',usage});
 },{logger:message=>logs.push(message)});
 assert.deepEqual(await analyze(filename),validateAppearance(raw,{strict:true}).appearance);assert.equal(calls,1);
 assert.equal(request.url,'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(request.options.method,'POST');assert.equal(request.options.headers.Authorization,`Bearer ${config.apiKey}`);
 assert.equal(request.options.headers['Content-Type'],'application/json');assert.equal(request.options.signal.aborted,false);
 assert.deepEqual(Object.keys(request.body).sort(),['model','stream','temperature','max_tokens','provider','messages','response_format'].sort());
 assert.equal(request.body.model,config.model);assert.equal(request.body.stream,false);assert.equal(request.body.temperature,0);assert.equal(request.body.max_tokens,350);
 assert.deepEqual(request.body.provider,{require_parameters:true});
 assert.equal(request.body.messages.length,1);assert.equal(request.body.messages[0].role,'user');
 const content=request.body.messages[0].content;assert.equal(content.length,2);assert.deepEqual(content[0],{type:'text',text:avatarPrompt()});
 assert.equal(content[1].type,'image_url');assert.deepEqual(Object.keys(content[1].image_url),['url']);
 const uri=content[1].image_url.url;assert.match(uri,/^data:image\/jpeg;base64,/);
 const jpeg=Buffer.from(uri.split(',')[1],'base64'),metadata=await sharp(jpeg).metadata();
 assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,384);assert.equal(metadata.height,768);
 assert.equal(metadata.orientation,undefined);assert.equal(metadata.hasAlpha,false);assert.equal(metadata.exif,undefined);
 assert.deepEqual(request.body.response_format,{type:'json_schema',json_schema:{name:'avatar_appearance',strict:true,schema:avatarSchema()}});
 assert.ok(!request.options.body.includes('private-name-email-uuid'));assert.ok(!request.options.body.includes(config.apiKey));
 const completed=JSON.parse(logs.find(l=>l.startsWith('[OpenRouter] completed ')).slice('[OpenRouter] completed '.length));
 assert.equal(completed.provider,'openrouter');assert.equal(completed.upstream_provider,'DeepInfra');assert.equal(completed.model,config.model);
 assert.equal(completed.http_status,200);assert.ok(completed.duration_ms>=0);
 assert.ok(completed.preparation_ms>=0);assert.ok(completed.http_ms>=0);
 for(const [key,value] of Object.entries(usage))assert.equal(completed[key],value);
 for(const secret of [config.apiKey,'Authorization',uri,uri.split(',')[1],filename,'hairStyle','selfie'])assert.ok(!logs.join('\n').includes(secret));
 // The existing normalizer is unchanged even for the prompt's no-beard rule.
 assert.equal(validateAppearance({...raw,facialHair:'none',facialHairColor:'unknown'},{strict:true}).appearance.facialHairColor,DEFAULT_AVATAR.facialHairColor);
});

test('OpenRouter rejects malformed envelopes, refusals, truncation, invalid JSON and invalid appearances',async t=>{
 const filename=await image();
 const missing={...raw};delete missing.shoes;
 const cases=[
  ['null body',null,'OPENROUTER_INVALID_RESPONSE'],['array body',[],'OPENROUTER_INVALID_RESPONSE'],
  ['choices absent',{},'OPENROUTER_INVALID_RESPONSE'],['choices wrong type',{choices:{}},'OPENROUTER_INVALID_RESPONSE'],
  ['choices empty',{choices:[]},'OPENROUTER_INVALID_RESPONSE'],['choice null',{choices:[null]},'OPENROUTER_INVALID_RESPONSE'],
  ['message absent',{choices:[{}]},'OPENROUTER_INVALID_RESPONSE'],['message null',{choices:[{message:null}]},'OPENROUTER_INVALID_RESPONSE'],
  ['content absent',{choices:[{finish_reason:'stop',message:{}}]},'OPENROUTER_INVALID_RESPONSE'],
  ['content null',envelope(null),'OPENROUTER_INVALID_RESPONSE'],['content empty',envelope(''),'OPENROUTER_INVALID_RESPONSE'],
  ['content whitespace',envelope(' \n '),'OPENROUTER_INVALID_RESPONSE'],['content array',envelope([]),'OPENROUTER_INVALID_RESPONSE'],
  ['invalid JSON',envelope('PRIVATE NOT JSON'),'INVALID_JSON'],['markdown',envelope('```json\n'+JSON.stringify(raw)+'\n```'),'INVALID_JSON'],
  ['null appearance',envelope('null'),'INVALID_APPEARANCE'],['array appearance',envelope('[]'),'INVALID_APPEARANCE'],
  ['extra field',envelope(JSON.stringify({...raw,gender:'PRIVATE'})),'INVALID_APPEARANCE'],
  ['missing field',envelope(JSON.stringify(missing)),'INVALID_APPEARANCE'],
  ['invalid enum',envelope(JSON.stringify({...raw,top:'PRIVATE'})),'INVALID_APPEARANCE'],
  ['invalid type',envelope(JSON.stringify({...raw,glasses:true})),'INVALID_APPEARANCE'],
  ['truncated valid JSON',envelope(JSON.stringify(raw),'length'),'OPENROUTER_TRUNCATED'],
  ['truncated JSON',envelope('{"hairStyle":','length'),'OPENROUTER_TRUNCATED'],
  ['unexpected finish',envelope(JSON.stringify(raw),'tool_calls'),'OPENROUTER_INVALID_RESPONSE'],
  ['missing finish',{choices:[{message:{content:JSON.stringify(raw)}}]},'OPENROUTER_INVALID_RESPONSE'],
  ['refusal',{choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw),refusal:'PRIVATE REFUSAL'}}]},'OPENROUTER_REFUSED'],
  ['content filter',envelope(JSON.stringify(raw),'content_filter'),'OPENROUTER_REFUSED'],
  ['inference error in HTTP 200',{error:{code:503,message:'PRIVATE ERROR',metadata:{raw:'PRIVATE'}}},'OPENROUTER_UNAVAILABLE']
 ];
 for(const [name,body,code] of cases)await t.test(name,async()=>{
  let calls=0;const logs=[];
  await assert.rejects(analyzer(async()=>{calls++;return Response.json(body);},{logger:l=>logs.push(l)})(filename),bounded(code));
  assert.equal(calls,1);assert.ok(!logs.join('\n').includes('PRIVATE'));assert.ok(!logs.join('\n').includes(config.apiKey));
 });
});

test('OpenRouter HTTP errors and network failures are bounded and never retry inside the analyzer',async t=>{
 const filename=await image();
 for(const status of [400,401,402,403,429,500,502,503,504])await t.test(String(status),async()=>{
  let calls=0;const logs=[];
  const code=[401,403].includes(status)?'OPENROUTER_AUTH_ERROR':status===429?'OPENROUTER_QUOTA':
   [500,502,503,504].includes(status)?'OPENROUTER_UNAVAILABLE':'OPENROUTER_API_ERROR';
  await assert.rejects(analyzer(async()=>{calls++;return new Response('PRIVATE REMOTE BODY',{status});},{logger:l=>logs.push(l)})(filename),bounded(code,status));
  assert.equal(calls,1);assert.ok(!logs.join('\n').includes('PRIVATE REMOTE BODY'));
  const diagnostic=JSON.parse(logs.at(-1).slice('[OpenRouter] failed '.length));
  assert.equal(diagnostic.stage,'http_response');assert.equal(diagnostic.http_status,status);
 });
 let calls=0;
 await assert.rejects(analyzer(async()=>{calls++;throw Error('PRIVATE NETWORK BODY');})(filename),bounded('OPENROUTER_UNAVAILABLE'));
 assert.equal(calls,1);
 await assert.rejects(analyzer(async()=>new Response('PRIVATE INVALID BODY',{status:200}))(filename),bounded('INVALID_JSON'));
 await assert.rejects(analyzer(async()=>{throw Error('Must not fetch');},{config:{...config,apiKey:''}})(filename),bounded('OPENROUTER_NOT_CONFIGURED'));
});

test('OpenRouter diagnostics distinguish connection resets, TLS/DNS and missing images without logging raw errors or changing retry codes',async()=>{
 const filename=await image();
 for(const causeCode of ['ECONNRESET','ENOTFOUND','UNABLE_TO_VERIFY_LEAF_SIGNATURE','PRIVATE_UNKNOWN_CODE']){
  const logs=[];let calls=0;
  const error=new TypeError('PRIVATE Authorization Bearer '+config.apiKey,{cause:Object.assign(new Error('PRIVATE data:image/jpeg;base64,SECRET'),{code:causeCode})});
  await assert.rejects(analyzer(async()=>{calls++;throw error;},{logger:line=>logs.push(line)})(filename),bounded('OPENROUTER_UNAVAILABLE'));
  assert.equal(calls,1);
  const diagnostic=JSON.parse(logs.at(-1).slice('[OpenRouter] failed '.length));
  assert.equal(diagnostic.stage,'http_request');assert.equal(diagnostic.http_status,undefined);
  assert.equal(diagnostic.cause_code,causeCode==='PRIVATE_UNKNOWN_CODE'?undefined:causeCode);
  for(const secret of ['PRIVATE','Authorization',config.apiKey,'data:image',filename])assert.ok(!logs.join('\n').includes(secret));
 }
 const logs=[];let calls=0;const missing=path.join(path.dirname(filename),'private-missing.png');
 await assert.rejects(analyzer(async()=>{calls++;},{logger:line=>logs.push(line)})(missing),bounded('OPENROUTER_UNAVAILABLE'));
 assert.equal(calls,0);const diagnostic=JSON.parse(logs.at(-1).slice('[OpenRouter] failed '.length));
 assert.equal(diagnostic.stage,'image_read');assert.equal(diagnostic.cause_code,'ENOENT');
 assert.ok(!logs.join('\n').includes(missing));
});

test('OpenRouter omits unavailable/invalid accounting and never logs raw successful or rejected content',async()=>{
 const filename=await image();
 for(const usage of [undefined,{}, {prompt_tokens:null,completion_tokens:'PRIVATE',total_tokens:-1,cost:'PRIVATE'}]){
  const logs=[];await analyzer(async()=>Response.json({...envelope(),usage}),{logger:l=>logs.push(l)})(filename);
  const log=JSON.parse(logs.at(-1).slice('[OpenRouter] completed '.length));
  for(const key of ['prompt_tokens','completion_tokens','total_tokens','cost'])assert.equal(Object.hasOwn(log,key),false);
  assert.ok(!logs.join('\n').includes('PRIVATE'));assert.ok(!logs.join('\n').includes('hairStyle'));
 }
});

test('OpenRouter timeout, external abort and already-aborted signal cancel the pending call without a retry or dangling promise',async()=>{
 const filename=await image();
 for(const external of [false,true]){
  const controller=new AbortController();let calls=0,observedSignal,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const fetchImpl=(_url,{signal})=>new Promise((_,reject)=>{
   calls++;observedSignal=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();
  });
  const pending=analyzer(fetchImpl,{config:{...config,timeoutMs:external?0:40}})(filename,{signal:controller.signal});
  const rejected=assert.rejects(pending,bounded('OPENROUTER_TIMEOUT'));
  await started;if(external)controller.abort();await rejected;
  assert.equal(observedSignal.aborted,true);assert.equal(calls,1);
 }
 for(const reason of [undefined,null,'custom abort']){
  const controller=new AbortController();controller.abort(reason);let calls=0;
  await assert.rejects(analyzer(async()=>{calls++;})(filename,{signal:controller.signal}),bounded('OPENROUTER_TIMEOUT'));
  assert.equal(calls,0);
 }
});

test('OpenRouter abort reaches a real HTTP socket; server stays healthy after cancellation',async()=>{
 const filename=await image();let closed,entered;
 const disconnected=new Promise(resolve=>{closed=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.end('ok');return;}
  req.resume();res.on('close',closed);entered(); // Deliberately never complete inference.
 });
 server.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const controller=new AbortController();
  const pending=analyzer((_url,options)=>fetch(base+'/slow',options),{config:{...config,timeoutMs:0}})(filename,{signal:controller.signal});
  const rejected=assert.rejects(pending,bounded('OPENROUTER_TIMEOUT'));
  await started;controller.abort();await rejected;
  await Promise.race([disconnected,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Socket was not cancelled')),2000);timer.unref();})]);
  assert.equal(await (await fetch(base+'/health')).text(),'ok');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
