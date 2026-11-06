const sharp=require('sharp');
const failure=(code,status)=>Object.assign(new Error(code),{code,...(Number.isInteger(status)?{status}:{})});
async function normalizePortrait(encoded){
 if(typeof encoded!=='string'||!encoded.length||encoded.length>28*1024*1024||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw failure('PORTRAIT_INVALID_RESPONSE');
 const image=Buffer.from(encoded,'base64');
 try{return await sharp(image,{limitInputPixels:20000000,failOn:'error'}).rotate().resize(512,512,{fit:'cover'}).png().toBuffer();}
 catch{throw failure('PORTRAIT_INVALID_RESPONSE');}finally{image.fill(0);}
}
async function photoMime(photo){
 try{const {format}=await sharp(photo,{limitInputPixels:20000000,failOn:'error'}).metadata();
  const mime={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'}[format];if(mime)return mime;
 }catch{}
 throw failure('PORTRAIT_INVALID_IMAGE');
}
function requestFailure(error,{signal,timeout,stage}){
 if(signal?.aborted)return failure('PORTRAIT_ABORTED');
 if(timeout?.aborted)return failure('PORTRAIT_TIMEOUT');
 if(/^PORTRAIT_(NOT_CONFIGURED|MODEL_INVALID|HTTP_ERROR|INVALID_RESPONSE|INVALID_IMAGE|QUOTA)$/.test(error.code))return failure(error.code,error.status);
 const network=new Set(['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
 if(['request','response'].includes(stage)&&[error.code,error.cause?.code].some(code=>network.has(code)))return failure('PORTRAIT_NETWORK_ERROR');
 return failure(stage==='response'?'PORTRAIT_INVALID_RESPONSE':'PORTRAIT_REQUEST_FAILED');
}
function eligible(error){return ![401,403].includes(error.status)&&([402,408,429].includes(error.status)||error.status>=500&&error.status<=599||['PORTRAIT_QUOTA','PORTRAIT_TIMEOUT','PORTRAIT_NETWORK_ERROR'].includes(error.code));}
module.exports={normalizePortrait,photoMime,requestFailure,failure,eligible};
