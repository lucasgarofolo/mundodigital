const fs=require('node:fs/promises');
const {normalizePortrait,photoMime,requestFailure,failure}=require('./portraitImage');
const PORTRAIT_PROMPT=`Transform the person in the provided photograph into a handcrafted 2D pixel art RPG character portrait.

Preserve the person's recognizable facial features, face shape, hairstyle, hair color, facial hair, skin tone and clothing.

Match the actual eyewear in the source photograph. Preserve eyeglasses only when clearly worn in that photograph. If the person is not wearing glasses, keep the face WITHOUT glasses. Never invent eyeglasses, sunglasses or decorative eyewear.

Front-facing head-and-shoulders composition, neutral expression, crisp square pixel clusters, limited color palette, deliberate pixel shading, clean dark outlines, retro 16-bit video game character portrait.

Use a solid, uniform light gray background (#D9D9D9). The background must be completely flat, with no gradients, shadows, textures, patterns or decorative elements.

Remove all objects, furniture, people and decorations from the original background.

Only one person. No text, no photorealistic textures, no full-body character.`;
const MODEL='@cf/black-forest-labs/flux-2-klein-4b';
function portraitConfig(env=process.env){
 const timeout=Number(env.CLOUDFLARE_PORTRAIT_TIMEOUT_MS);
 return {accountId:env.CLOUDFLARE_ACCOUNT_ID||'',token:env.CLOUDFLARE_API_TOKEN||'',model:env.CLOUDFLARE_PORTRAIT_MODEL||MODEL,
  timeoutMs:Number.isInteger(timeout)&&timeout>0&&timeout<=600000?timeout:120000};
}
function createCloudflarePortrait({config=portraitConfig(),fetchImpl=fetch}={}){
 return async function generate(photoPath,{signal,onUsage=()=>{}}={}){
  if(!/^[a-f0-9]{32}$/i.test(config.accountId)||!config.token)throw Object.assign(new Error('PORTRAIT_NOT_CONFIGURED'),{code:'PORTRAIT_NOT_CONFIGURED'});
  if(![MODEL,'@cf/black-forest-labs/flux-2-klein-9b'].includes(config.model))throw Object.assign(new Error('PORTRAIT_MODEL_INVALID'),{code:'PORTRAIT_MODEL_INVALID'});
  const photo=await fs.readFile(photoPath);
  let timeout,stage='prepare';
  try{
   signal?.throwIfAborted();const mime=await photoMime(photo);
   const form=new FormData();form.set('prompt',PORTRAIT_PROMPT);form.set('width','512');form.set('height','512');
   form.set('input_image_0',new Blob([photo],{type:mime}),'selfie.'+mime.split('/')[1]);
   timeout=AbortSignal.timeout(config.timeoutMs);const combined=signal?AbortSignal.any([signal,timeout]):timeout;combined.throwIfAborted();stage='request';
   const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`,{
    method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form,
    signal:combined});
   if(!response.ok){await response.body?.cancel();throw failure('PORTRAIT_HTTP_ERROR',response.status);}
   stage='response';
   const body=await response.json();const encoded=body.result?.image;
   combined.throwIfAborted();
   if(typeof body?.usage?.cost==='number'&&Number.isFinite(body.usage.cost)&&body.usage.cost>=0)onUsage({cost:body.usage.cost});
   if(body.success!==true&&body.errors?.some(e=>e.code===3036))throw failure('PORTRAIT_QUOTA');
   if(body.success!==true)
    throw Object.assign(new Error('PORTRAIT_INVALID_RESPONSE'),{code:'PORTRAIT_INVALID_RESPONSE'});
   return await normalizePortrait(encoded);
  }catch(error){
   throw requestFailure(error,{signal,timeout,stage});
  }finally{photo.fill(0);}
 };
}
module.exports={createCloudflarePortrait,portraitConfig,PORTRAIT_PROMPT,MODEL};
