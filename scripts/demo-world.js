const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createApplication}=require('../server');
const {composeAvatar}=require('../lib/lpcAvatarBuilder');
const {DEFAULT_AVATAR,validateAppearance}=require('../lib/avatarCatalog');

// A separate local world: no real registrations, selfies, AI calls or changes to .env.
async function createDemoWorld(count=100){
  if(!Number.isInteger(count)||count<1||count>100)throw new Error('Use de 1 a 100 participantes fictícios.');
  const root=path.resolve(__dirname,'../.test-data');await fs.mkdir(root,{recursive:true});
  const dataDir=await fs.mkdtemp(path.join(root,'demo-world-'));
  const runtime=await createApplication({dataDir,avatarProvider:'local',operatorKey:'',logger:()=>{},
    generatePortrait:async()=>{throw Object.assign(new Error('Demonstração local sem portrait.'),{code:'PORTRAIT_NOT_CONFIGURED'});}});
  try{
    const {WORLD}=await import('../public/js/world.js'),{createWalker}=await import('../public/js/movement.js');
    const colors=['blue','red','green','yellow','purple','orange','dark_blue','white','black','brown','gray','dark_gray'];
    const hair=['short','curly_short','bob','ponytail','spiked','buzzcut','long','shoulder'];
    const hairColors=['black','brown','blonde','gray','red','dark_brown'];
    const variants=[];
    for(let i=0;i<Math.min(count,12);i++){
      const {appearance}=validateAppearance({...DEFAULT_AVATAR,hairStyle:hair[i%hair.length],hairColor:hairColors[i%hairColors.length],
        top:['tshirt','polo','shirt','hoodie'][i%4],topColor:colors[i],bottom:i%2?'jeans':'pants',
        glasses:['none','rectangular','round','thin'][i%4],facialHair:i%3?'none':'short_beard'}, {strict:true});
      const buffer=await composeAvatar(appearance),version=createHash('sha256').update(buffer).digest('hex').slice(0,16);
      variants.push({appearance,buffer,version});
    }
    const blocks=Object.values(WORLD.blocks);
    for(let i=0;i<count;i++){
      const block=blocks[i%blocks.length],localIndex=Math.floor(i/blocks.length);
      const pois=block.pointsOfInterest.filter(p=>p.visitable!==false&&p.areaId!=='area_access');
      const poi=pois[localIndex%pois.length],node=block.navigationNodes.find(n=>n.id===poi.nodeId);
      const id=randomUUID(),variant=variants[i%variants.length],filename=`${id}-${variant.version}.png`;
      await fs.writeFile(path.join(dataDir,'avatars',filename),variant.buffer);
      const walker=createWalker({id,name:`Demo${String(i+1).padStart(3,'0')}`,avatar:`/avatars/${filename}`,avatarKind:'lpc',avatarType:'lpc',
        avatarStatus:'READY',appearance:variant.appearance,avatarVersion:variant.version,experienceStatus:'ACTIVE',allowExploration:true,hasLeftAccess:true,
        currentBlock:block.id,currentFloor:block.floor,currentNode:node.id,currentArea:node.areaId,currentRoom:node.roomId,
        position:{x:node.x,y:node.y},remaining:.1},i,{visitController:runtime.visitController});
      // Begin on an existing lane and use the normal reservation/route selection.
      walker.position={x:node.x+walker.routeOffset.x,y:node.y+walker.routeOffset.y};
      if(!runtime.visitController.select(walker,poi.id))runtime.visitController.select(walker);
      runtime.store.insert(walker,`${id}@demo.example.test`,Date.now());runtime.walkers.set(id,walker);
    }
    return {...runtime,dataDir};
  }catch(error){await runtime.close();throw error;}
}

if(require.main===module){
  (async()=>{
    try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
    const count=Number(process.argv[2]||100),port=Number(process.argv[3]||3001);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Porta de demonstração inválida.');
    const runtime=await createDemoWorld(count);
    try{
      await new Promise((resolve,reject)=>{runtime.server.once('error',reject);runtime.server.listen(port,'127.0.0.1',resolve);});
    }catch(error){await runtime.close();throw error;}
    console.log(`Demonstração: ${count} avatares fictícios, ${Math.min(count,12)} variações LPC locais, cinco blocos.`);
    console.log(`Abra http://127.0.0.1:${port}/tela?block=blockA_upper`);
    console.log(`Banco isolado: ${runtime.dataDir}`);
    console.log('A demonstração também exige login. Crie um administrador nesse DATA_DIR com scripts/create-admin.js em outro terminal.');
    console.log('Ctrl+C encerra esta demonstração. O banco principal e o .env não foram alterados.');
    const stop=async()=>{await runtime.close();process.exit(0);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={createDemoWorld};
