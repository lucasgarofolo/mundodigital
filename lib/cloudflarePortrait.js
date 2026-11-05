const fs=require('node:fs/promises');
const sharp=require('sharp');
const PORTRAIT_PROMPT=`Transform the person in the provided photograph into a handcrafted 2D pixel art RPG character portrait.

Preserve the person's recognizable facial features, face shape, hairstyle, hair color, facial hair, eyeglasses, skin tone and clothing.

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
 return async function generate(photoPath,{signal}={}){
  if(!/^[a-f0-9]{32}$/i.test(config.accountId)||!config.token)throw Object.assign(new Error('PORTRAIT_NOT_CONFIGURED'),{code:'PORTRAIT_NOT_CONFIGURED'});
  if(config.model!==MODEL)throw Object.assign(new Error('PORTRAIT_MODEL_INVALID'),{code:'PORTRAIT_MODEL_INVALID'});
  const photo=await fs.readFile(photoPath);
  try{
   const form=new FormData();form.set('prompt',PORTRAIT_PROMPT);form.set('width','512');form.set('height','512');
   form.set('input_image_0',new Blob([photo],{type:'image/png'}),'selfie.png');
   const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`,{
    method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form,
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]):AbortSignal.timeout(config.timeoutMs)});
   if(!response.ok)throw Object.assign(new Error('PORTRAIT_HTTP_ERROR'),{code:'PORTRAIT_HTTP_ERROR',status:response.status});
   const body=await response.json();const encoded=body.result?.image;
   if(body.success!==true||typeof encoded!=='string'||!encoded.length||encoded.length>28*1024*1024||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw Object.assign(new Error('PORTRAIT_INVALID_RESPONSE'),{code:'PORTRAIT_INVALID_RESPONSE'});
   const image=Buffer.from(encoded,'base64');
   try{return await sharp(image,{limitInputPixels:20000000,failOn:'error'}).rotate().resize(512,512,{fit:'cover'}).png().toBuffer();}
   finally{image.fill(0);}
  }catch(error){
   const safe=new Set(['PORTRAIT_NOT_CONFIGURED','PORTRAIT_MODEL_INVALID','PORTRAIT_HTTP_ERROR','PORTRAIT_INVALID_RESPONSE']);
   throw Object.assign(new Error(safe.has(error.code)?error.code:'PORTRAIT_REQUEST_FAILED'),{code:safe.has(error.code)?error.code:'PORTRAIT_REQUEST_FAILED',status:Number.isInteger(error.status)?error.status:undefined});
  }finally{photo.fill(0);}
 };
}
module.exports={createCloudflarePortrait,portraitConfig,PORTRAIT_PROMPT,MODEL};
