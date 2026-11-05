const fs=require('node:fs/promises');
const sharp=require('sharp');
const {avatarSchema,validateAppearance}=require('./avatarCatalog');
const {avatarPrompt}=require('./geminiAvatarAnalyzer');

function openRouterConfig(env=process.env){
 const value=Number(env.OPENROUTER_AVATAR_TIMEOUT_MS);
 return {apiKey:env.OPENROUTER_API_KEY,model:env.OPENROUTER_AVATAR_MODEL||'qwen/qwen3-vl-30b-a3b-instruct',
  timeoutMs:env.OPENROUTER_AVATAR_TIMEOUT_MS!==undefined&&env.OPENROUTER_AVATAR_TIMEOUT_MS.trim()!==''&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:30000};
}

const failure=(code,status)=>Object.assign(new Error(code),{code,...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{})});
// Raw fetch/Sharp errors can contain paths, headers or image data. Log only known codes.
function diagnosticCode(error){
 const allowed=new Set(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID','ERR_SSL_WRONG_VERSION_NUMBER',
  'ENOENT','EACCES','EPERM','EIO']);
 return [error?.code,error?.cause?.code,error?.cause?.cause?.code].find(code=>allowed.has(code));
}
function httpFailure(status){
 const code=[401,403].includes(status)?'OPENROUTER_AUTH_ERROR':status===429?'OPENROUTER_QUOTA':
  [500,502,503,504].includes(status)?'OPENROUTER_UNAVAILABLE':'OPENROUTER_API_ERROR';
 return failure(code,status);
}

function createOpenRouterAvatarAnalyzer({config=openRouterConfig(),fetchImpl=fetch,logger=message=>console.log(message)}={}){
 return async function analyzeSelfie(imagePath,{signal}={}){
  const started=performance.now(),metrics={provider:'openrouter',model:config.model};
  let source,jpeg,timeout,abortSignal=signal,stage='configuration';
  try{
   if(typeof config.apiKey!=='string'||!config.apiKey.trim())throw failure('OPENROUTER_NOT_CONFIGURED');
   signal?.throwIfAborted();
   stage='image_read';
   source=await fs.readFile(imagePath);
   stage='image_prepare';
   try{jpeg=await sharp(source,{limitInputPixels:20000000,failOn:'error'}).rotate()
    .resize(768,768,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:82}).toBuffer();}
   finally{source.fill(0);}
   const controller=new AbortController();
   timeout=config.timeoutMs>0?setTimeout(()=>controller.abort(),config.timeoutMs):undefined;
   abortSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
   abortSignal.throwIfAborted();
   logger(`[OpenRouter] request ${JSON.stringify(metrics)}`);
   stage='http_request';
   const response=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},signal:abortSignal,
    body:JSON.stringify({model:config.model,stream:false,temperature:0,max_tokens:350,provider:{require_parameters:true},
     messages:[{role:'user',content:[{type:'text',text:avatarPrompt()},
      {type:'image_url',image_url:{url:`data:image/jpeg;base64,${jpeg.toString('base64')}`}}]}],
     response_format:{type:'json_schema',json_schema:{name:'avatar_appearance',strict:true,schema:avatarSchema()}}})
   });
   metrics.http_status=response.status;
   stage='http_response';
   if(!response.ok){await response.body?.cancel().catch(()=>{});throw httpFailure(response.status);}
   stage='response_parse';
   const body=await response.json();
   // Only numerical accounting fields and a bounded provider identifier enter logs.
   Object.assign(metrics,Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','cost']
    .filter(key=>typeof body?.usage?.[key]==='number'&&Number.isFinite(body.usage[key])&&body.usage[key]>=0&&
     (key==='cost'||Number.isSafeInteger(body.usage[key])))
    .map(key=>[key,body.usage[key]])));
   if(typeof body?.provider==='string'&&/^[a-zA-Z0-9 ._/-]{1,64}$/.test(body.provider))metrics.upstream_provider=body.provider;
   // OpenRouter can report an inference error inside an HTTP 200 envelope.
   if(body?.error)throw httpFailure(body.error.code);
   stage='response_validation';
   const choice=Array.isArray(body?.choices)?body.choices[0]:undefined,message=choice?.message;
   if(!body||typeof body!=='object'||Array.isArray(body)||!choice||!message||typeof message!=='object'||Array.isArray(message))
    throw failure('OPENROUTER_INVALID_RESPONSE');
   if(message.refusal||choice.finish_reason==='content_filter')throw failure('OPENROUTER_REFUSED');
   if(choice.finish_reason==='length')throw failure('OPENROUTER_TRUNCATED');
   if(choice.finish_reason!=='stop'||typeof message.content!=='string'||!message.content.trim())throw failure('OPENROUTER_INVALID_RESPONSE');
   abortSignal.throwIfAborted();
   stage='appearance_validation';
   const raw=JSON.parse(message.content),{appearance}=validateAppearance(raw,{strict:true});
   logger(`[OpenRouter] completed ${JSON.stringify({...metrics,duration_ms:Math.round(performance.now()-started)})}`);
   return appearance;
  }catch(error){
   const safeCodes=new Set(['OPENROUTER_NOT_CONFIGURED','OPENROUTER_AUTH_ERROR','OPENROUTER_QUOTA','OPENROUTER_UNAVAILABLE',
    'OPENROUTER_API_ERROR','OPENROUTER_INVALID_RESPONSE','OPENROUTER_REFUSED','OPENROUTER_TRUNCATED','INVALID_APPEARANCE']);
   const code=abortSignal?.aborted?'OPENROUTER_TIMEOUT':error instanceof SyntaxError?'INVALID_JSON':
    safeCodes.has(error?.code)?error.code:'OPENROUTER_UNAVAILABLE';
   const safe=failure(code,error?.status);
   const diagnostic=diagnosticCode(error);
   logger(`[OpenRouter] failed ${JSON.stringify({...metrics,code,stage,...(diagnostic?{cause_code:diagnostic}:{}),
    ...(safe.status?{status:safe.status}:{}),duration_ms:Math.round(performance.now()-started)})}`);
   throw safe;
  }finally{clearTimeout(timeout);source?.fill(0);jpeg?.fill(0);}
 };
}
module.exports={openRouterConfig,createOpenRouterAvatarAnalyzer};
