const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {composeLayers,readJson}=require('./lpcCompositor');
const {mapAppearance}=require('./avatarLpcMapper');
let catalog;
async function composeAvatar(appearance){
 catalog??=Promise.all([readJson('manifest.json'),readJson('options-manifest.json'),readJson('options-palettes.json')]);
 const [base,extra,palettes]=await catalog;
 const lookup=new Map([...base.layers.map(l=>({...l,localFile:`${l.id}.png`})),...extra.layers].map(l=>[l.id,l]));
 const mapped=mapAppearance(appearance);
 const layers=mapped.layers.map(layer=>{
  const source=lookup.get(layer.id);if(!source)throw new Error('LPC asset not imported');
  return {...source,palette:layer.palette,color:layer.color};
 });
 return composeLayers(layers,palettes);
}
async function buildLpcAvatar({participantUuid,appearance,avatarDir}){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participantUuid))throw new Error('Invalid participant UUID');
 const buffer=await composeAvatar(appearance),version=createHash('sha256').update(buffer).digest('hex').slice(0,16);
 const filename=`${participantUuid}-${version}.png`;
 // Content-addressed, immutable URL; never overwrite the provisional texture.
 await fs.writeFile(path.join(avatarDir,filename),buffer,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 return {avatarUrl:`/avatars/${filename}`,avatarVersion:version,avatarKind:'lpc',avatarType:'lpc'};
}
module.exports={composeAvatar,buildLpcAvatar};
