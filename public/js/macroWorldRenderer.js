import {WORLD,drawWorld,project,box,floorTiles} from './world.js';
import {INITIAL_BLOCK} from './macroWorldConfig.js';
import {createMachineVisual} from './visitVisualEffects.js';

const textStyle={fontFamily:'monospace',fontSize:'13px',color:'#e8f0e6',stroke:'#172f3c',strokeThickness:3,align:'center'};
function label(scene,x,y,text,size=13){
  const p=project(x,y);
  return scene.add.text(p.x,p.y,text,{...textStyle,fontSize:`${size}px`}).setOrigin(.5).setDepth(1500);
}
function machine(scene,area){
  if(area.theme==='plaza'){
    const g=scene.add.graphics().setDepth(120),b=area.bounds;
    box(g,b.x+2,b.y+1,3,1,12,0x4c776c);
    box(g,b.x+3.4,b.y+1.2,.15,.15,90,0xc6d1cc);
    box(g,b.x+3.5,b.y+1.2,1.2,.08,85,0x78bc87,63);return;
  }
  const o=area.obstacles[0],{x,y,width:w,height:h}=o;
  const g=scene.add.graphics().setDepth(project(x+w,y+h).y);
  const metal=0x9cb2ae,dark=0x304653,accent=area.color;
  const cube=(dx,dy,cw,ch,z,color=metal,base=0)=>box(g,x+dx,y+dy,cw,ch,z,color,base);
  const line=(points,color=0xe4be63,width=3)=>{
    g.lineStyle(width,color);g.strokePoints(points.map(([dx,dy,z=0])=>{const p=project(x+dx,y+dy);return {x:p.x,y:p.y-z};}));
  };
  const disc=(dx,dy,z,r,color)=>{const p=project(x+dx,y+dy);g.fillStyle(color);g.fillCircle(p.x,p.y-z,r);};
  cube(0,0,w,h,27,accent);cube(.1,.1,w-.2,h-.2,30,metal,27);
  switch(area.theme){
    case 'robot':
      cube(1,.5,.7,.7,47,dark,30);
      break; // The same arm is drawn separately so it can move briefly.
    case 'printer':case 'cnc':
      cube(.3,.2,2.4,1.6,85,dark,30);cube(.5,.2,2,1.2,80,0x579ba5,38);
      cube(.7,.15,1.6,.1,77,metal,72);
      if(area.theme==='cnc')cube(1.35,.35,.35,.5,67,0xe0b167,49);
      else cube(2.25,.15,.3,.1,58,0x82d4ad,45);break;
    case 'laser':
      cube(.2,.15,2.6,1.65,43,dark,30);cube(.4,.35,2.2,1.2,45,0x68b9ba,43);
      line([[.5,.5,60],[2.4,.5,60],[2.4,1.4,60]],metal,4);break;
    case 'storage':
      for(let row=0;row<3;row++)for(let col=0;col<3;col++)cube(.1+col*.95,.3,.8,1.1,48+row*21,0xb79b72,30+row*21);
      break;
    case 'office':case 'sewing':
      for(let i=0;i<2;i++){
        cube(.3+i*1.3,.5,1,.45,area.theme==='sewing'?52:66,dark,32);
        if(area.theme==='office')cube(.38+i*1.3,.45,.8,.08,62,0x70bcbe,42);
        else cube(.3+i*1.3,.7,.3,.6,48,metal,32);
      }break;
    case 'kitchen':
      for(const dx of [.7,2])for(const dy of [.6,1.3])disc(dx,dy,32,8,dark);
      cube(.8,.7,.5,.5,47,metal,32);break;
    case 'air':
      cube(.2,.1,2.6,.8,70,0xd5ddcd,30);
      for(let i=0;i<5;i++)line([[.4,.15+i*.1,47],[2.5,.15+i*.1,47]],dark,2);break;
    case 'pneumatic':case 'hydraulic':case 'electric':
      cube(.2,.1,2.6,.25,90,dark,30);
      for(let i=0;i<3;i++){
        line([[.6+i*.8,.08,42],[.6+i*.8,.08,73],[1+i*.65,.08,73]],area.theme==='electric'?0xd7a84d:0x70bac9,4);
        disc(.6+i*.8,.08,78,7,0xe1e4d0);disc(.6+i*.8,.08,78,2,dark);
      }break;
    case 'lathe':case 'mill':
      cube(.2,.2,.7,1.6,67,dark,30);cube(2.2,.2,.6,1.6,57,dark,30);
      cube(.8,.7,1.5,.5,49,metal,36);
      if(area.theme==='mill')cube(1.2,.3,.6,.6,94,accent,49);
      else line([[.8,1,51],[2.2,1,51]],0xd7c9a8,6);break;
    case 'injection':
      cube(.1,.2,1.2,1.5,79,accent,30);cube(1.4,.3,1.4,1.3,55,dark,30);
      cube(.35,.45,.5,.6,95,metal,79);break;
    case 'crane':
      for(const dx of [.15,2.65])cube(dx,.15,.2,1.7,124,0xd0ad58,30);
      cube(.15,.15,2.7,.25,130,0xe4b64d,118);
      break; // Hook/carriage is the existing part, now independently redrawable.
    case 'welding':
      cube(.3,.2,.6,.6,74,0x477f96,30);cube(2,.5,.7,1,49,dark,30);
      line([[.6,.6,55],[1.4,1.5,33],[2.3,1,49]],0xe4a05c,3);break;
    default: // Metrology and fitting: different instruments on a shared workbench.
      line([[.4,.6,35],[2.5,.6,35],[2.5,1.2,35]],dark,4);
      cube(.8,.8,.2,.6,area.theme==='metrology'?68:43,dark,32);
      cube(1.2,1.1,1.2,.2,38,0xd6bd7e,32);
  }
  createMachineVisual(scene,area);
}

export function blockScreenBounds(block){
  const b=block.bounds,corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>project(x,y));
  const x=Math.min(...corners.map(p=>p.x))-30,y=Math.min(...corners.map(p=>p.y))-150;
  return {x,y,width:Math.max(...corners.map(p=>p.x))-x+30,height:Math.max(...corners.map(p=>p.y))-y+55};
}

export function drawBlock(scene,blockId,{debug=false}={}){
  scene.characters?.visualEffects.clear();
  scene.visitDebug=null;
  for(const object of scene.blockObjects||[])object.destroy();
  scene.machineVisuals=new Map();
  const before=new Set(scene.children.list),block=WORLD.blocks[blockId];
  const floor=scene.add.graphics().setDepth(-200);
  floorTiles(floor,{x:-2,y:block.layout.offset,width:29,height:18},[0x405965,0x445e69]);
  if(blockId===INITIAL_BLOCK){
    floorTiles(floor,{x:-1.6,y:10.3,width:1.2,height:10},[0x637d86,0x6a848b]);
    drawWorld(scene); // Original access-room art and doorway, unchanged.
  }
  for(const area of Object.values(block.areas)){
    if(!area.theme||area.theme==='access')continue;
    floorTiles(floor,area.bounds,[area.color,Phaser.Display.Color.IntegerToColor(area.color).darken(4).color]);
    machine(scene,area);
    const b=area.bounds;
    label(scene,b.x+b.width/2,b.y+b.height-.2,area.name,12);
  }
  if(block.areas.area_inovacao)label(scene,16,8,'SETOR DE INOVAÇÃO',13);
  for(const portal of block.portals){
    const node=block.navigationNodes.find(n=>n.id===portal.nodeId),p=project(node.x,node.y);
    const g=scene.add.graphics().setDepth(-90);
    box(g,node.x-.6,node.y-.4,1.2,.8,3,portal.type==='stairs'?0xd7b274:0x80c7b9);
    if(portal.type==='stairs')for(let i=0;i<4;i++)box(g,node.x-.5,node.y-.35+i*.17,1,.17,(4-i)*3,0xe2c595);
    scene.add.text(p.x,p.y+24,portal.name,{...textStyle,fontSize:'10px'}).setOrigin(.5).setDepth(1500);
  }
  if(debug){
    const g=scene.add.graphics().setDepth(2000);g.lineStyle(2,0x85efb8,.8);
    const nodes=new Map(block.navigationNodes.map(n=>[n.id,n]));
    for(const [a,b] of block.connections){const p=project(nodes.get(a).x,nodes.get(a).y),q=project(nodes.get(b).x,nodes.get(b).y);g.lineBetween(p.x,p.y,q.x,q.y);}
    for(const n of nodes.values()){
      const p=project(n.x,n.y);g.fillStyle(n.id.startsWith('exit_')?0xffa95e:0xf4e991);g.fillCircle(p.x,p.y,4);
      if(!block.pointsOfInterest.some(p=>p.visitable!==false&&p.nodeId===n.id))
        label(scene,n.x,n.y,`${n.id}\n${n.areaId||'circulação'}`,9).setDepth(2001).y-=17;
    }
    const b=block.bounds;g.lineStyle(2,0xff8cc9);g.strokePoints([[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>project(x,y)),true);
    label(scene,12,block.layout.offset,`${block.id} · ${block.pointsOfInterest.length} POIs`,14);
    scene.visitDebug={graphics:scene.add.graphics().setDepth(2100),labels:new Map(),
      panel:label(scene,12,block.layout.offset-1,'',9).setOrigin(.5,1)};
    for(const poi of block.pointsOfInterest.filter(p=>p.visitable!==false)){
      const x=poi.visitorSlots.reduce((sum,s)=>sum+s.x,0)/poi.visitorSlots.length;
      const y=poi.visitorSlots.reduce((sum,s)=>sum+s.y,0)/poi.visitorSlots.length;
      const annotation=label(scene,x,y,'',9).setDepth(2101);annotation.y+=50;
      scene.visitDebug.labels.set(poi.id,annotation);
    }
  }
  scene.blockObjects=scene.children.list.filter(o=>!before.has(o));
  scene.blockBounds=blockScreenBounds(block);
  if(debug)updateVisitDebug(scene,scene.participantsClient?.visitDebug);
  return block;
}

export function updateVisitDebug(scene,snapshot){
  if(!scene.debugWorld||!scene.visitDebug)return;
  const block=WORLD.blocks[scene.currentBlock],view=scene.visitDebug,g=view.graphics;g.clear();
  const entries=new Map((snapshot?.pois||[]).filter(p=>p.blockId===block.id).map(p=>[p.poiId,p]));
  for(const poi of block.pointsOfInterest.filter(p=>p.visitable!==false)){
    const entry=entries.get(poi.id),occupied=new Set((entry?.slots||[]).filter(s=>s.occupied).map(s=>s.id));
    const machine=scene.machineVisuals?.get(poi.id);
    const group=snapshot?.social?.groups?.find(g=>g.blockId===block.id&&g.poiId===poi.id);
    view.labels.get(poi.id)?.setText(`${poi.id}\nslots: ${occupied.size}/${poi.capacity}`+
      (machine?`\nmachine: ${machine.state}`:'')+(group?`\nvisitors: ${group.visitors.join(', ')}`:''));
    for(const slot of poi.visitorSlots){
      const p=project(slot.x,slot.y);g.lineStyle(2,occupied.has(slot.id)?0xffa95e:0x92efcf);
      g.strokeCircle(p.x,p.y,6);
      if(occupied.has(slot.id)){g.fillStyle(0xffa95e);g.fillCircle(p.x,p.y,4);}
    }
  }
  const people=(snapshot?.participants||[]).filter(p=>p.currentBlock===block.id);
  view.panel.setText(people.slice(0,10).map(p=>`${p.ref} ${p.state} → ${p.targetPoi||'-'}/${p.targetSlot||'-'} · ${p.currentBlock}/${p.currentArea}\n`+
    `behavior: ${p.behavior||'observe'} ${p.phase||''} · emote: ${p.emote||'-'} · machine: ${p.machineAnimation||'-'}\n`+
    `social: ${p.socialState||'NONE'} → ${p.socialTarget||'-'} · cooldown: ${Math.ceil((p.socialCooldownMs||0)/1000)}s · nearby: ${p.nearbyParticipants||0}`).join('\n')+
    (people.length>10?`\n+ ${people.length-10} participantes neste bloco`:''));
}
