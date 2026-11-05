// Conceptual topology, not a surveyed architectural plan. All coordinates are tiles.
import {directionForMovement} from './avatar/lpcConfig.js';
import {poiVisualSettings} from './visitVisualBehavior.js';
export const INITIAL_BLOCK='blockB_upper';
export const INITIAL_AREA='area_access';
export const EXPLORATION={get interBlockProbability(){return 1-WORLD_BEHAVIOR.localDestinationProbability;},accessVisits:3};
export const WORLD_BEHAVIOR={localDestinationProbability:.85,minInitialStayMs:4000,maxInitialStayMs:9000,
  recentPoiMemory:3,minRetryMs:1200,maxRetryMs:3000};
const VISIT_PROFILES={default:{capacity:3,minStayMs:5000,maxStayMs:15000,weight:1},
  robot:{capacity:3,weight:1.5},printer:{weight:1.3},laser:{weight:1.2},cnc:{capacity:2,weight:1.4},
  plaza:{capacity:8,minStayMs:7000,maxStayMs:18000},access:{capacity:2,minStayMs:4000,maxStayMs:9000}};
const ACCESS_LOOK_AT={bancada_a:{x:2.1,y:1.8},bancada_b:{x:9.9,y:1.8},terminal_sala5:{x:6,y:1.8},
  mesa_a:{x:1.9,y:5.6},mesa_b:{x:10.1,y:5.6}};
function facingSlot(slot,focus){
  const dx=focus.x-slot.x,dy=focus.y-slot.y;
  return {...slot,facing:directionForMovement((dx-dy)*2,dx+dy)};
}
function visitSettings(poi,theme,row=0){
  const profile={...VISIT_PROFILES.default,...VISIT_PROFILES[theme]};
  const xs=profile.capacity===2?[-.6,.6]:[-1,0,1];
  const visitorSlots=theme==='plaza'?Array.from({length:8},(_,i)=>({id:`slot_${i}`,x:poi.x-1.5+i%4,y:poi.y-1.9+Math.floor(i/4),facing:'right'})):
    xs.map((dx,i)=>({id:`slot_${i}`,x:poi.x+dx,y:poi.y+(theme==='access'?.85:row?1:-1),facing:row?'left':'right'}));
  const focus=theme==='access'?(ACCESS_LOOK_AT[poi.nodeId]||{x:poi.x,y:poi.y-2}):
    {x:poi.x-.5,y:poi.y+(theme==='plaza'?-3.5:row?3:-3)};
  return {...profile,...poiVisualSettings(theme),visitorSlots:visitorSlots.map(slot=>facingSlot(slot,focus)),visitable:true};
}
const definitions={
  blockA_upper:['Bloco A · Superior',[
    ['area_praca_civica','Praça Cívica','plaza'],
    ['area_robot_arm','Braço Robótico','robot','area_inovacao'],
    ['area_3d_printing','Impressão 3D','printer','area_inovacao'],
    ['area_laser_cutting','Corte a Laser','laser','area_inovacao']]],
  blockB_upper:['Bloco B · Superior',[
    ['area_almoxarife','Almoxarife','storage'],
    ['area_assistente_administrativo','Assistente Administrativo','office'],
    ['area_culinaria','Culinária','kitchen'],
    ['area_ar_condicionado','Ar-Condicionado','air'],
    ['area_corte_costura','Corte e Costura','sewing']]],
  blockB_lower:['Bloco B · Inferior',[
    ['area_pneumatica','Pneumática','pneumatic'],['area_hidraulica','Hidráulica','hydraulic'],
    ['area_metrologia','Metrologia','metrology'],['area_manutencao_mecanica','Manutenção Mecânica','tools']]],
  blockC_upper:['Bloco C · Superior',[
    ['area_eletrica','Elétrica','electric'],['area_solda','Solda','welding']]],
  blockC_lower:['Bloco C · Inferior',[
    ['area_tornearia','Tornearia','lathe'],['area_fresadora','Fresadora','mill'],['area_cnc','CNC','cnc'],
    ['area_ajustagem','Ajustagem','tools'],['area_injetora_plastica','Injetora Plástica','injection'],
    ['area_ponte_rolante','Ponte Rolante','crane']]],
};
const colors=[0x668d91,0x647e9c,0x9c8164,0x698a78,0x827797,0x958951];

export function createBlocks(accessFloor){
  const blocks={};
  for(const [id,[name,sectors]] of Object.entries(definitions)){
    const access=id===INITIAL_BLOCK,offset=access?11:0,hubY=offset+9;
    const block=blocks[id]={id,name,floor:id.endsWith('lower')?'lower_floor':'ground_floor',
      areas:{area_circulation:{id:'area_circulation',name:'Circulação',agents:[]}},navigationNodes:[],connections:[],portals:[],spawnPoints:{},pointsOfInterest:[],
      bounds:{x:access?-3.6:-2,y:0,width:access?29.6:29,height:offset+18},
      layout:{offset,hubY},defaultZoom:1};
    for(let col=0;col<3;col++){
      block.navigationNodes.push({id:`aisle_${col}`,x:4+col*8,y:hubY,areaId:null});
      if(col)block.connections.push([`aisle_${col-1}`,`aisle_${col}`]);
    }
    sectors.forEach(([areaId,areaName,theme,parentArea],i)=>{
      const col=i%3,row=Math.floor(i/3),x=col*8,y=offset+(row?11:1);
      const area=block.areas[areaId]={id:areaId,name:areaName,parentArea,theme,color:colors[i%colors.length],
        bounds:{x,y,width:7.6,height:6},agents:[],obstacles:[]};
      const node={id:`poi_${areaId}`,x:x+4,y:offset+(row?12:6),areaId};
      block.navigationNodes.push(node);block.connections.push([`aisle_${col}`,node.id]);
      const poi={id:node.id,nodeId:node.id,blockId:id,areaId,name:areaName,x:node.x,y:node.y};
      block.pointsOfInterest.push({...poi,...visitSettings(poi,theme,row)});
      // Machinery stays away from the aisle and visitor lanes.
      if(theme!=='plaza')area.obstacles.push({x:x+2,y:offset+(row?14:2),width:3,height:2});
    });
    if(id==='blockA_upper'){
      block.areas.area_inovacao={id:'area_inovacao',name:'Setor de Inovação',agents:[],
        children:['area_robot_arm','area_3d_printing','area_laser_cutting']};
      // Parent area is a grouping alias, not a second destination on the robot's slots.
      block.pointsOfInterest.push({...block.pointsOfInterest[1],id:'poi_area_inovacao',areaId:'area_inovacao',visitable:false,capacity:0,visitorSlots:[]});
      const plaza=block.pointsOfInterest[0];
      block.pointsOfInterest.push({...plaza,id:'poi_praca_display',name:'Praça Cívica · Exposição',capacity:3,
        visitorSlots:[3.6,4.6,5.6].map((y,i)=>facingSlot({id:`slot_${i}`,x:1.2,y},{x:3.5,y:2.5}))});
    }
    if(access){
      block.areas[INITIAL_AREA]={id:INITIAL_AREA,name:'Sala de Acesso',theme:'access',agents:[],
        bounds:{...accessFloor.rooms.sala5_acesso.bounds},obstacles:accessFloor.rooms.sala5_acesso.furniture};
      block.navigationNodes.push(...accessFloor.navigationNodes.map(n=>({...n,areaId:INITIAL_AREA})),
        {id:'access_threshold',x:1.9,y:9,areaId:INITIAL_AREA},
        {id:'access_corridor',x:1.9,y:10.2,areaId:null},
        {id:'access_turn',x:-1,y:10.2,areaId:null},
        {id:'access_exit',x:-1,y:hubY,areaId:null});
      block.connections.push(...accessFloor.navigationEdges,['porta_sala5','access_threshold'],
        ['access_threshold','access_corridor'],['access_corridor','access_turn'],
        ['access_turn','access_exit'],['access_exit','aisle_0']);
      block.pointsOfInterest.push(...accessFloor.pointsOfInterest.map(p=>({...p,areaId:INITIAL_AREA,blockId:id,
        ...visitSettings(p,'access'),...(p.nodeId==='porta_sala5'?{visitable:false,capacity:0,visitorSlots:[]}:{} )})));
      block.spawnPoints={...accessFloor.spawnPoints};block.entry=accessFloor.entry;
    }
    // A normal spawn is also the corresponding portal landing node, never a random coordinate.
    block.spawnPoints.center={nodeId:'aisle_1',x:12,y:hubY};
    block.navigationEdges=block.connections;
  }
  const pairs=[['blockB_upper','blockA_upper','passage'],['blockB_upper','blockC_upper','passage'],
    ['blockB_upper','blockB_lower','stairs'],['blockC_upper','blockC_lower','stairs']];
  for(const [a,b,type] of pairs)for(const [source,target] of [[a,b],[b,a]]){
    const block=blocks[source],index=block.portals.length,nodeId=`exit_to_${target}`;
    const col=index%3,node={id:nodeId,x:4+col*8,y:block.layout.hubY+.9,areaId:null};
    block.navigationNodes.push(node);block.connections.push([`aisle_${col}`,nodeId]);
    block.portals.push({id:nodeId,nodeId,type,enabled:true,targetBlock:target,
      targetNode:`exit_to_${source}`,name:`${type==='stairs'?'Escada':'Passagem'} → ${blocks[target].name}`});
    block.spawnPoints[nodeId]={nodeId,x:node.x,y:node.y};
  }
  for(const block of Object.values(blocks))for(const node of block.navigationNodes){
    node.blockId=block.id;node.roomId=node.areaId===INITIAL_AREA?'sala5_acesso':node.areaId||'circulation';
  }
  return blocks;
}
