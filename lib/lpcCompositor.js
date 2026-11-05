const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const assets=path.resolve(__dirname,'../public/assets/avatars/lpc');
const rawLayers=new Map();
function rgb(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
async function composeLayers(layers,palettes){
 const composite=[];
 for(const layer of [...layers].sort((a,b)=>a.zPos-b.zPos)){
  const filename=path.join(assets,'sources',layer.localFile);
  if(!rawLayers.has(filename))rawLayers.set(filename,sharp(filename).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
  let source;
  try{source=await rawLayers.get(filename);}catch(error){rawLayers.delete(filename);throw error;}
  const info=source.info,data=Buffer.from(source.data);
  if(info.width!==576||info.height!==256)throw new Error('Invalid LPC frame layout');
  if(layer.palette){
   const palette=palettes[layer.palette];
   if(!palette?.colors[layer.color])throw new Error('Unsupported LPC palette');
   const from=palette.base.map(rgb),to=palette.colors[layer.color].map(rgb);
   for(let i=0;i<data.length;i+=4){
    if(!data[i+3])continue;
    const index=from.findIndex(c=>c.every((v,j)=>Math.abs(v-data[i+j])<=1));
    if(index>=0)for(let j=0;j<3;j++)data[i+j]=to[index][j];
   }
  }
  composite.push({input:await sharp(data,{raw:info}).png().toBuffer(),left:0,top:0});
 }
 return sharp({create:{width:576,height:256,channels:4,background:'#00000000'}}).composite(composite).png().toBuffer();
}
async function readJson(file){return JSON.parse(await fs.readFile(path.join(assets,'sources',file),'utf8'));}
module.exports={composeLayers,readJson};
