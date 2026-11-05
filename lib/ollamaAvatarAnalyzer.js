const fs=require('node:fs/promises');
const sharp=require('sharp');
const {avatarSchema,validateAppearance,AVATAR_CATALOG}=require('./avatarCatalog');
const {avatarPrompt}=require('./geminiAvatarAnalyzer');

function ollamaConfig(env=process.env){
 const baseUrl=env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
 const url=new URL(baseUrl);
 if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)
  throw new Error('OLLAMA_BASE_URL deve apontar para o Ollama local.');
 const model=env.OLLAMA_MODEL||'gemma4:12b';
 if(model.endsWith(':cloud'))throw new Error('Use um modelo Ollama instalado localmente, sem :cloud.');
 const value=Number(env.OLLAMA_TIMEOUT_MS);
 return {baseUrl:url.origin,model,timeoutMs:env.OLLAMA_TIMEOUT_MS!==undefined&&env.OLLAMA_TIMEOUT_MS.trim()!==''&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:0,
  logResponse:env.OLLAMA_LOG_RESPONSE===undefined?env.NODE_ENV!=='production':env.OLLAMA_LOG_RESPONSE==='true'};
}

function createOllamaAvatarAnalyzer({config=ollamaConfig(),fetchImpl=fetch,logger=message=>console.log(message)}={}){
 return async function analyzeSelfie(imagePath,{signal}={}){
  const source=await fs.readFile(imagePath);let jpeg;
  try{jpeg=await sharp(source,{limitInputPixels:20000000,failOn:'error'}).rotate()
   .resize(768,768,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:82}).toBuffer();}
  finally{source.fill(0);}
  const controller=new AbortController(),timeout=config.timeoutMs>0?setTimeout(()=>controller.abort(),config.timeoutMs):undefined;
  const abortSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  try{
   logger(`[Ollama] Requisição local enviada: modelo=${config.model}, timeoutMs=${config.timeoutMs}`);
   const response=await fetchImpl(new URL('/api/chat',config.baseUrl),{method:'POST',headers:{'Content-Type':'application/json'},signal:abortSignal,
    body:JSON.stringify({model:config.model,stream:false,think:false,format:avatarSchema(),
     messages:[{role:'user',content:avatarPrompt(),images:[jpeg.toString('base64')]}],
     options:{temperature:0,num_ctx:4096,num_predict:2048},keep_alive:'5m'})});
   if(!response.ok)throw Object.assign(new Error('OLLAMA_API_ERROR'),{code:'OLLAMA_API_ERROR',status:response.status});
   const body=await response.json(),raw=JSON.parse(body.message?.content);
   const {appearance}=validateAppearance(raw,{strict:true});
   logger('[Ollama] Resposta recebida e validada.');
   if(config.logResponse)logger(`[Ollama] Características:\n${JSON.stringify(Object.fromEntries(Object.keys(AVATAR_CATALOG).map(field=>[field,raw[field]])),null,2)}`);
   return appearance;
  }catch(error){
   const code=abortSignal.aborted?'OLLAMA_TIMEOUT':error.code==='INVALID_APPEARANCE'?'INVALID_APPEARANCE':error instanceof SyntaxError?'INVALID_JSON':
    error.code==='OLLAMA_API_ERROR'?'OLLAMA_API_ERROR':'OLLAMA_UNAVAILABLE';
   logger(`[Ollama] Falha: code=${code}, status=${Number.isInteger(error.status)?error.status:'indisponível'}`);
   throw Object.assign(new Error(code),{code,status:Number.isInteger(error.status)?error.status:undefined});
  }finally{clearTimeout(timeout);jpeg.fill(0);}
 };
}
module.exports={ollamaConfig,createOllamaAvatarAnalyzer};
