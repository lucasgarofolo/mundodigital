import { WORLD, groundFloor, routeBetween } from './world.js';
import {INITIAL_BLOCK,INITIAL_AREA,chooseMacroDestination,arriveMacroNode,bindVisitController,visitControllerFor} from './macroNavigation.js';

const random=(min,max)=>min+Math.random()*(max-min);

// Shared by the demo and the authoritative server. No Phaser or screen coordinates.
export function createWalker(data,index,{enter=false,visitController}={}) {
  const spawn=groundFloor.spawnPoints.sala5;
  const [ox,oy]=spawn.offsets[index%spawn.offsets.length];
  const angle=index*Math.PI/4;
  const routeOffset={x:Math.cos(angle)*WORLD.movement.laneRadius,y:Math.sin(angle)*WORLD.movement.laneRadius};
  const walker={
    id:data.id,name:data.name,index,avatar:data.avatar,avatarKind:data.avatarKind,createdAt:data.createdAt,cycleId:data.cycleId,
    currentFloor:WORLD.activeFloor,currentRoom:WORLD.activeRoom,currentBlock:INITIAL_BLOCK,currentArea:INITIAL_AREA,
    spawnPointId:spawn.id,currentNode:spawn.nodeId,
    position:{x:spawn.x+ox,y:spawn.y+oy},speed:random(WORLD.movement.minSpeed,WORLD.movement.maxSpeed),
    destination:null,state:'IDLE',remaining:random(.3,2.8),route:[],visits:0,routeOffset,elapsed:Math.random()*10,
    ...data,
    get x(){return this.position.x;},get y(){return this.position.y;},
  };
  // Old saves without spatial fields keep Sala 5. Incomplete newer saves recover
  // at a node of their own area/block, never at the global check-in spawn.
  const block=WORLD.blocks[walker.currentBlock]||WORLD.blocks[INITIAL_BLOCK];
  walker.currentBlock=block.id;walker.currentFloor=block.floor;
  const known=block.navigationNodes.find(n=>n.id===walker.currentNode);
  const entering=walker.state==='ENTERING'&&block.id===INITIAL_BLOCK&&walker.route?.length;
  if(!enter&&!entering&&(!known||!Number.isFinite(walker.position?.x)||!Number.isFinite(walker.position?.y))){
    const poi=block.pointsOfInterest.find(p=>p.areaId===walker.currentArea);
    const node=block.navigationNodes.find(n=>n.id===(poi?.nodeId||block.spawnPoints.center.nodeId));
    walker.position={x:node.x+walker.routeOffset.x,y:node.y+walker.routeOffset.y};walker.currentNode=node.id;
    walker.currentArea=node.areaId||'area_circulation';walker.currentRoom=node.roomId;
    walker.route=[];walker.destination=null;walker.state='IDLE';walker.remaining=.3;
  }
  if(enter) {
    const entry=groundFloor.entry;
    const [dx,dy]=entry.offsets[index%entry.offsets.length];
    walker.position={x:entry.start.x+dx,y:entry.start.y+dy};
    walker.state='ENTERING';walker.currentNode=entry.targetNode;
    walker.route=entry.path.map(node=>({...node,x:node.x+routeOffset.x,y:node.y+routeOffset.y}));
  }
  if(!Number.isFinite(walker.speed)||walker.speed<=0) throw new Error('Velocidade inválida.');
  // Facing is spatial presentation; visit reservations/timers remain in the controller's WeakMap.
  Object.defineProperty(walker,'facing',{value:data.facing||null,writable:true,configurable:true,enumerable:false});
  if(walker.allowExploration){
    const visits=bindVisitController(walker,visitController);
    if(data.destination===null&&data.experienceStatus==='ACTIVE'&&['WALKING','VISITING'].includes(data.state))visits.recover(walker);
    if(walker.state==='IDLE'&&walker.currentArea===INITIAL_AREA&&!walker.visits)visits.initialStay(walker);
    if(walker.destination&&!walker.destination.targetBlock)walker.destination=null;
  }
  return walker;
}

export function chooseDestination(walker) {
  if(walker.allowExploration){chooseMacroDestination(walker);return;}
  const choices=groundFloor.pointsOfInterest.filter(p=>p.id!==walker.destination?.id);
  walker.destination=choices[Math.floor(Math.random()*choices.length)];
  const nodes=routeBetween(walker.currentNode,walker.destination.nodeId);
  const start=groundFloor.navigationNodes.find(node=>node.id===walker.currentNode);
  walker.route=[start,...nodes].map(node=>({...node,x:node.x+walker.routeOffset.x,y:node.y+walker.routeOffset.y}));
  walker.state='WALKING';
}

export function updateWalker(walker,delta,visitController) {
  const dt=Math.min(delta/1000,.1);
  const visits=walker.allowExploration?(visitController?bindVisitController(walker,visitController):visitControllerFor(walker)):null;
  walker.elapsed+=dt;
  if(visits&&!visits.eligible(walker)){visits.release(walker);return;}
  if(visits&&walker.state!=='ENTERING'&&!visits.validate(walker))return;
  if(walker.state!=='WALKING'&&walker.state!=='ENTERING') {
    if(visits?.wait(walker,dt*1000))return;
    walker.remaining-=dt;
    if(walker.remaining<=0) chooseDestination(walker);
    return;
  }
  const target=walker.route[0];
  if(!target) {
    if(walker.state==='ENTERING') {walker.state='IDLE';walker.remaining=.2;visits?.initialStay(walker);}
    else if(visits){if(!visits.arrive(walker)){walker.state='IDLE';walker.remaining=random(.5,1.5);}}
    else {walker.state='VISITING';walker.visits++;walker.remaining=random(WORLD.visitSeconds.min,WORLD.visitSeconds.max);}
    return;
  }
  const dx=target.x-walker.x,dy=target.y-walker.y,distance=Math.hypot(dx,dy),step=walker.speed*dt;
  if(distance<=step) {
    walker.position={x:target.x,y:target.y};walker.currentNode=target.id;walker.currentRoom=target.roomId||walker.currentRoom;walker.route.shift();
    if(walker.allowExploration&&walker.state!=='ENTERING')arriveMacroNode(walker,target);
  } else {walker.position.x+=dx/distance*step;walker.position.y+=dy/distance*step;}
}
