// Explicit, pinned imports. Run only to refresh the checked-in asset catalog.
const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'../public/assets/avatars/lpc');
const repository='https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator';
const commit='58ce1aa479e4df32845a73a5d0afc221c3a893c2';
const imports=[
 ['buzzcut','hair/bald/hair_buzzcut'],['spiked','hair/spiky/hair_spiked'],
 ['curly_short','hair/curly/hair_curly_short'],['curly_medium','hair/curly/hair_curly_long'],
 ['bob','hair/bob/hair_bob'],['shoulder','hair/braids/hair_shoulderl'],
 ['long','hair/long/hair_long'],['ponytail','hair/braids/hair_ponytail'],
 ['moustache','hair/mustaches/beards_mustache'],['full_beard','hair/beards/beards_medium'],
 ['round','headwear/accessories/glasses/facial_glasses_round'],
 ['thin','headwear/accessories/glasses/facial_glasses_halfmoon'],
 ['polo','torso/shirts/shortsleeve/torso_clothes_shortsleeve_polo'],
 ['shirt','torso/shirts/longsleeve/torso_clothes_longsleeve_formal'],
 ['hoodie','torso/shirts/longsleeve/torso_clothes_longsleeve'],
 ['jacket','torso/jacket/torso_jacket_collared'],
 ['jeans','legs/pants/legs_pants2'],['shorts','legs/shorts/legs_shorts'],
 ['skirt','legs/skirts/legs_skirts_plain'],
];
async function get(file){
 const response=await fetch(`https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/${commit}/${file}`);
 if(!response.ok)throw new Error(`LPC import ${response.status}: ${file}`);
 return response;
}
async function main(){
 const manifest={repository,commit,compositeLicense:'CC-BY-SA 4.0',layers:[]};
 const downloads=[];
 for(const [id,definition] of imports){
  const def=await (await get(`sheet_definitions/${definition}.json`)).json();
  if(def.animations&&!def.animations.includes('walk'))throw new Error(`No walk: ${id}`);
  for(const [layerName,layer] of Object.entries(def).filter(([k])=>k.startsWith('layer_'))){
   if(!layer.male)throw new Error(`No configured body: ${id}`);
   const suffix=id==='round'||id==='thin'?'walk/black.png':id==='jacket'?'walk/white.png':'walk.png';
   const file=`spritesheets/${layer.male}${suffix}`;
   const credit=def.credits.filter(c=>layer.male.startsWith(c.file)).sort((a,b)=>b.file.length-a.file.length)[0];
   const license=['OGA-BY 3.0','CC0','CC-BY 4.0','CC-BY-SA 3.0'].find(l=>credit?.licenses.includes(l));
   if(!license)throw new Error(`Unsupported license: ${id}`);
   const localId=layerName==='layer_1'?id:`${id}_bg`;
   const entry={...credit,id:localId,file,definition:`sheet_definitions/${definition}.json`,zPos:layer.zPos,license,
    sourceUrl:`${repository}/blob/${commit}/${file}`,localFile:`options/${localId}.png`};
   manifest.layers.push(entry);downloads.push(entry);
  }
 }
 // Credits prepared before downloading art, and retained alongside it.
 let credits=await fs.readFile(path.resolve(__dirname,'../CREDITS-LPC.md'),'utf8');
 credits=credits.split('\n## Fase 4.1 — catálogo adicional')[0];
 credits+='\n## Fase 4.1 — catálogo adicional\n\nMesma revisão fixa. Alterações: recoloração por paleta e composição alpha local. As composições personalizadas da Fase 4.1 são disponibilizadas sob CC-BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ . As fontes conservam suas licenças individuais abaixo. Isto se refere à arte composta, não ao código ou às selfies. A escolha de licença é uma alternativa expressamente oferecida pelos autores.\n\n';
 for(const l of manifest.layers)credits+=`### ${l.id}\n\n- Asset: \`${l.file}\`\n- Fonte: ${l.sourceUrl}\n- Autores: ${l.authors.join('; ')}.\n- Licença escolhida: ${l.license}; alternativas: ${l.licenses.join(', ')}.\n- Observações: ${l.notes||'Nenhuma.'}\n- Origens: ${l.urls.join(', ')}\n\n`;
 credits+='Licenças: OGA-BY 3.0: https://static.opengameart.org/OGA-BY-3.0.txt ; CC0: https://creativecommons.org/publicdomain/zero/1.0/ ; CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/ ; CC-BY-SA 3.0: https://creativecommons.org/licenses/by-sa/3.0/ ; CC-BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ .\n';
 await fs.writeFile(path.resolve(__dirname,'../CREDITS-LPC.md'),credits);
 await fs.writeFile(path.join(root,'CREDITS-LPC.md'),credits);
 await fs.mkdir(path.join(root,'sources/options'),{recursive:true});
 for(const entry of downloads){
  const bytes=Buffer.from(await (await get(entry.file)).arrayBuffer());
  const meta=await sharp(bytes).metadata();
  if(meta.width!==576||meta.height!==256)throw new Error(`Unsupported walk layout: ${entry.id}: ${meta.width}x${meta.height}`);
  await fs.writeFile(path.join(root,'sources',entry.localFile),bytes);
  console.log(entry.id,meta.width,meta.height,entry.license);
 }
 await fs.writeFile(path.join(root,'sources/options-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const palettes={};
 for(const [kind,base] of [['body','light'],['hair','orange'],['cloth','white']]){
  const colors=await (await get(`palette_definitions/${kind}/${kind}_ulpc.json`)).json();
  palettes[kind]={base:colors[base],colors};
 }
 await fs.writeFile(path.join(root,'sources/options-palettes.json'),JSON.stringify(palettes,null,2)+'\n');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
