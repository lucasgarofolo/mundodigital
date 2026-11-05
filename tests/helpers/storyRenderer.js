// Lightweight local export for tests whose subject is entry/LPC, not browser rendering.
const fs=require('node:fs/promises'),sharp=require('sharp');
let png;
module.exports={async render(_data,{outputPath}){png??=sharp({create:{width:1080,height:1920,channels:3,background:'#12343a'}}).png().toBuffer();await fs.writeFile(outputPath,await png);},async close(){}};
