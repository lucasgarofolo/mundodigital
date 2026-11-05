const sharp=require('sharp');
const {createHash}=require('node:crypto');

const MAX_SELFIE_BYTES=5*1024*1024;
async function validateSelfie(file) {
  if(!file||!file.buffer?.length) throw Object.assign(new Error('Envie uma selfie.'),{status:400});
  if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw Object.assign(new Error('Use uma foto JPEG, PNG ou WebP.'),{status:400});
  try {
    const image=sharp(file.buffer,{limitInputPixels:20000000,failOn:'error'});
    const meta=await image.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)!==1||meta.width<32||meta.height<32) throw new Error('Imagem inválida');
    return await image.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  } catch {throw Object.assign(new Error('Não foi possível ler a foto. Use JPEG, PNG ou WebP, com até 20 megapixels.'),{status:400});}
}

// Explicitly a generic local placeholder. The selfie is NOT analyzed by this provider.
async function generateLocalAvatar({id}) {
  const hash=createHash('sha256').update(id).digest('hex');
  const shirt=`#${hash.slice(0,6)}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" shape-rendering="crispEdges">
    <path fill="#263e49" d="M8 35h6v10H8zM18 35h6v10h-6z"/>
    <path fill="${shirt}" d="M6 19h20v17H6z"/>
    <path fill="#dcb18b" d="M8 5h16v14H8zM2 22h4v11H2zM26 22h4v11h-4z"/>
    <path fill="#4b3d38" d="M6 2h20v7H6zM6 9h4v5H6z"/>
    <path fill="#273b45" d="M20 12h2v3h-2z"/><path fill="#e8eee2" d="M14 21h3v7h-3z"/>
  </svg>`;
  return {buffer:await sharp(Buffer.from(svg)).resize(64,96,{kernel:'nearest'}).png().toBuffer(),kind:'local-placeholder'};
}

function createAvatarGenerator(provider=process.env.AVATAR_PROVIDER||'local') {
  if(provider!=='local') throw new Error('Provedor de IA ainda não configurado. Use AVATAR_PROVIDER=local para testar sem custos.');
  return generateLocalAvatar;
}
module.exports={validateSelfie,createAvatarGenerator,MAX_SELFIE_BYTES};
