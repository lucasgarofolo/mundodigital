const fs=require('node:fs/promises');
const {PORTRAIT_PROMPT}=require('./cloudflarePortrait');
const {normalizePortrait,photoMime,requestFailure,failure}=require('./portraitImage');
const MODEL='black-forest-labs/flux-3-image-klein';
function openRouterPortraitConfig(env=process.env){
 const timeoutMs=env.OPENROUTER_PORTRAIT_TIMEOUT_MS===undefined?120000:Number(env.OPENROUTER_PORTRAIT_TIMEOUT_MS);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>600000)throw Error('OPENROUTER_PORTRAIT_TIMEOUT_MS deve ser um inteiro entre 1 e 600000.');
 const model=env.OPENROUTER_PORTRAIT_MODEL??MODEL;
 if(!/^[a-zA-Z0-9._/-]{1,160}$/.test(model))throw Error('OPENROUTER_PORTRAIT_MODEL inválido.');
 // An explicitly empty portrait key must not charge the shared key by accident.
 return {apiKey:env.OPENROUTER_PORTRAIT_API_KEY??env.OPENROUTER_API_KEY??'',model,timeoutMs};
}
function createOpenRouterPortrait({config=openRouterPortraitConfig(),fetchImpl=fetch}={}){
 return async function generate(photoPath,{signal,onUsage=()=>{}}={}){
  let photo,timeout,stage='prepare';
  try{
   if(!config.apiKey.trim())throw failure('PORTRAIT_NOT_CONFIGURED');
   signal?.throwIfAborted();photo=await fs.readFile(photoPath);const mime=await photoMime(photo);
   timeout=AbortSignal.timeout(config.timeoutMs);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
   combined.throwIfAborted();stage='request';
   const response=await fetchImpl('https://openrouter.ai/api/v1/images',{method:'POST',
    headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},signal:combined,
    body:JSON.stringify({model:config.model,prompt:PORTRAIT_PROMPT,input_references:[{type:'image_url',image_url:{url:`data:${mime};base64,${photo.toString('base64')}`}}],aspect_ratio:'1:1'})});
   if(!response.ok){await response.body?.cancel();throw failure('PORTRAIT_HTTP_ERROR',response.status);}
   stage='response';const body=await response.json();combined.throwIfAborted();
   if(body?.error)throw failure('PORTRAIT_HTTP_ERROR',Number(body.error.code));
   if(typeof body?.usage?.cost==='number'&&Number.isFinite(body.usage.cost)&&body.usage.cost>=0)onUsage({cost:body.usage.cost});
   return await normalizePortrait(body?.data?.[0]?.b64_json);
  }catch(error){throw requestFailure(error,{signal,timeout,stage});}finally{photo?.fill(0);}
 };
}
module.exports={createOpenRouterPortrait,openRouterPortraitConfig,MODEL};
