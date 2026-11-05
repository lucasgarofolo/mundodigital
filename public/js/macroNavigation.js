import {WORLD,routeBetween,isPositionWalkable} from './world.js';
import {INITIAL_BLOCK,INITIAL_AREA,EXPLORATION,WORLD_BEHAVIOR} from './macroWorldConfig.js';
import {createVisualVisit,sampleVisualVisit} from './visitVisualBehavior.js';
import {createSocialController,sampleSocialInteraction} from './socialBehavior.js';
export {INITIAL_BLOCK,INITIAL_AREA};

export function chooseMacroDestination(walker){
  return visitControllerFor(walker).select(walker);
}

// One controller per simulation. Reservations, history and visit clocks never enter SQLite.
const controllers=new WeakMap();
export function bindVisitController(walker,controller=defaultVisits){
  if(controllers.get(walker)===controller)return controller;
  controllers.get(walker)?.release(walker);controllers.set(walker,controller);controller.register(walker);return controller;
}
export function visitControllerFor(walker){return controllers.get(walker)||bindVisitController(walker);}
export function createVisitController({random=Math.random,behavior={},socialConfig={}}={}){
  const settings={...WORLD_BEHAVIOR,...behavior},states=new WeakMap(),claims=new Map();
  let visitId=0;
  const between=(min,max)=>min+random()*(max-min);
  const key=(block,poi,slot)=>`${block}/${poi}/${slot}`;
  const eligible=w=>w.status!=='INACTIVE'&&(!w.experienceStatus||['ENTERING','ACTIVE'].includes(w.experienceStatus));
  const state=w=>{if(!states.has(w))states.set(w,{recent:[],target:null,slot:null,waitMs:null,stayMs:0});return states.get(w);};
  const freeSlots=poi=>(poi.visitorSlots||[]).slice(0,poi.capacity).filter(slot=>!claims.has(key(poi.blockId,poi.id,slot.id)));
  const social=createSocialController({random,config:socialConfig,view:w=>{
    const s=states.get(w);return s?.target?{poi:s.target,slot:s.slot,stayMs:s.stayMs,visual:s.visual,valid:valid(w),
      theme:WORLD.blocks[w.currentBlock]?.areas[s.target.areaId]?.theme}:null;
  }});
  function release(w){
    social.cancel(w);
    const s=states.get(w);if(!s)return;
    if(s.target&&claims.get(key(s.target.blockId,s.target.id,s.slot.id))===w)claims.delete(key(s.target.blockId,s.target.id,s.slot.id));
    s.target=null;s.slot=null;s.stayMs=0;s.visual=null;w.facing=null;
  }
  function valid(w){
    const s=state(w),poi=s.target;
    return !!poi&&eligible(w)&&poi.blockId===w.currentBlock&&
      WORLD.blocks[w.currentBlock]?.pointsOfInterest.includes(poi)&&poi.visitorSlots.slice(0,poi.capacity).includes(s.slot)&&
      claims.get(key(poi.blockId,poi.id,s.slot.id))===w;
  }
  function park(w){
    w.destination=null;w.state='IDLE';w.route=[];
    state(w).waitMs=between(settings.minRetryMs,settings.maxRetryMs);
    // Vacate the observation slots before waiting on the existing graph's lane.
    if(WORLD.blocks[w.currentBlock]?.navigationNodes.some(n=>n.id===w.currentNode))planMacroRoute(w,w.currentNode);
  }
  function validate(w){
    if(state(w).target&&!valid(w)){release(w);state(w).goal=null;park(w);return false;}return true;
  }
  function portalTo(from,to){
    const queue=[{block:from,first:null}],seen=new Set([from]);
    for(const item of queue)for(const portal of WORLD.blocks[item.block].portals){
      if(!portal.enabled||seen.has(portal.targetBlock))continue;
      const first=item.first||portal;if(portal.targetBlock===to)return first;
      seen.add(portal.targetBlock);queue.push({block:portal.targetBlock,first});
    }
    return null;
  }
  function explore(w,targetBlock){
    release(w);const s=state(w),block=WORLD.blocks[w.currentBlock];
    const portal=targetBlock?portalTo(block.id,targetBlock):block.portals[Math.floor(random()*block.portals.length)];
    if(!portal)return false;
    s.goal=targetBlock||portal.targetBlock;s.waitMs=null;
    planMacroRoute(w,portal.nodeId);w.destination=portal;return true;
  }
  function select(w,poiId){
    release(w);const s=state(w),block=WORLD.blocks[w.currentBlock];
    if(!eligible(w)||!block)return false;
    if(!poiId&&s.goal&&s.goal!==w.currentBlock)return explore(w,s.goal);
    const initial=w.currentArea===INITIAL_AREA&&!w.hasLeftAccess&&w.visits<EXPLORATION.accessVisits;
    if(!poiId&&!initial&&!s.justEntered&&random()>settings.localDestinationProbability&&explore(w))return true;
    s.goal=null;s.justEntered=false;
    let choices=block.pointsOfInterest.filter(p=>p.visitable!==false&&p.capacity>0&&p.weight>0&&freeSlots(p).length&&
      (!poiId||p.id===poiId)&&(!w.hasLeftAccess||p.areaId!==INITIAL_AREA)&&
      (poiId||(initial?p.areaId===INITIAL_AREA:p.areaId!==INITIAL_AREA)));
    // Relax only the oldest memories when an area has fewer available alternatives.
    for(let memory=s.recent.length;memory>0;memory--){
      const filtered=choices.filter(p=>!s.recent.slice(-memory).includes(`${p.blockId}/${p.id}`));
      if(filtered.length){choices=filtered;break;}
    }
    if(!choices.length){park(w);return false;}
    let draw=random()*choices.reduce((sum,p)=>sum+p.weight,0),poi=choices.at(-1);
    for(const candidate of choices){draw-=candidate.weight;if(draw<0){poi=candidate;break;}}
    const slots=freeSlots(poi),slot=slots[Math.floor(random()*slots.length)];
    // Synchronous selection + reservation in the authoritative update loop is atomic.
    claims.set(key(block.id,poi.id,slot.id),w);s.target=poi;s.slot=slot;s.waitMs=null;
    try{
      planMacroRoute(w,poi.nodeId);w.destination=null;
      const node=block.navigationNodes.find(n=>n.id===poi.nodeId);
      w.route.push({...node,x:slot.x,y:slot.y});
    }catch(error){release(w);throw error;}
    return true;
  }
  function arrive(w){
    const s=state(w);
    if(!valid(w)||Math.hypot(w.x-s.slot.x,w.y-s.slot.y)>.01){release(w);return false;}
    w.state='VISITING';w.visits++;w.facing=s.slot.facing;
    s.stayMs=between(s.target.minStayMs,s.target.maxStayMs);
    s.visual=createVisualVisit(s.target,w.facing,s.stayMs,random,++visitId);
    s.recent.push(`${s.target.blockId}/${s.target.id}`);s.recent=settings.recentPoiMemory>0?s.recent.slice(-settings.recentPoiMemory):[];
    return true;
  }
  function wait(w,dt){
    const s=state(w);
    if(!eligible(w)){release(w);return true;}
    if(s.target&&!valid(w)){release(w);park(w);return true;}
    if(s.target&&w.state==='VISITING'){
      if(s.visual){s.visual.elapsedMs+=dt;w.facing=sampleVisualVisit(s.visual).facing;}
      w.facing=sampleSocialInteraction(w.socialInteraction).facing||w.facing;
      s.stayMs-=dt;if(s.stayMs<=0)select(w);return true;
    }
    if(s.waitMs!==null){s.waitMs-=dt;if(s.waitMs<=0)select(w);return true;}
    return false;
  }
  const api={select,explore,arrive,wait,release,valid,validate,eligible,recover:park,social,
    register(w){
      for(const owner of new Set(claims.values()))if(owner!==w&&owner.id===w.id)release(owner);state(w);
      // Explicit public snapshots may send this; generic walker/SQLite serialization must not.
      Object.defineProperty(w,'visualVisit',{configurable:true,enumerable:false,get:()=>states.get(w)?.visual?{...states.get(w).visual}:null});
      social.register(w);
    },
    initialStay(w){state(w).waitMs=between(settings.minInitialStayMs,settings.maxInitialStayMs);},
    transition(w){const s=state(w);release(w);s.justEntered=true;s.waitMs=1000;},
    reconcile(walkers){for(const w of new Set(claims.values())){
      if(walkers.get(w.id)!==w||!eligible(w))release(w);
      else if(!valid(w))validate(w);
      else if(!['WALKING','VISITING'].includes(w.state)){release(w);park(w);}
    }},
    clear(){social.clear();for(const w of new Set(claims.values()))release(w);claims.clear();},
    info(w){const s=states.get(w);return {targetPoi:s?.target?.id||null,targetSlot:s?.slot?.id||null,
      stayMs:s?.stayMs||0,waitMs:s?.waitMs??null,recentPoiIds:[...(s?.recent||[])],
      behavior:s?.visual?.behavior||'observe',...sampleVisualVisit(s?.visual),...social.inspect(w)};},
    snapshot(walkers){return {pois:Object.values(WORLD.blocks).flatMap(b=>b.pointsOfInterest.filter(p=>p.visitable!==false).map(p=>({
      blockId:b.id,poiId:p.id,capacity:p.capacity,slots:p.visitorSlots.map(slot=>({id:slot.id,occupied:claims.has(key(b.id,p.id,slot.id))}))}))),
      participants:[...walkers.values()].map(w=>({ref:w.id.slice(0,8),state:w.state,currentBlock:w.currentBlock,currentArea:w.currentArea,
        targetPoi:states.get(w)?.target?.id||null,targetSlot:states.get(w)?.slot?.id||null,
        behavior:states.get(w)?.visual?.behavior||'observe',...sampleVisualVisit(states.get(w)?.visual),...social.inspect(w)})),
      social:social.snapshot(walkers)};},
    get occupied(){return claims.size;}
  };
  return api;
}
const defaultVisits=createVisitController();

export function planMacroRoute(walker,nodeId){
  const block=WORLD.blocks[walker.currentBlock];
  const start=block.navigationNodes.find(n=>n.id===walker.currentNode);
  if(!start)throw new Error(`Nó inválido em ${block.id}: ${walker.currentNode}`);
  // Offsets stay constant across graph segments, so no shortcuts cut through furniture.
  const offset=walker.routeOffset;
  walker.route=[start,...routeBetween(start.id,nodeId,block)].map(n=>({...n,x:n.x+offset.x,y:n.y+offset.y}));
  walker.state='WALKING';
}

export function arriveMacroNode(walker,target){
  const block=WORLD.blocks[walker.currentBlock];
  target=block.navigationNodes.find(n=>n.id===target.id)||target;
  walker.currentArea=target.areaId||'area_circulation';
  walker.currentRoom=target.roomId||'circulation';
  if(walker.currentArea!==INITIAL_AREA)walker.hasLeftAccess=true;
  const portal=block.portals.find(p=>p.nodeId===target.id);
  // A paired portal only fires when it is the chosen destination. Walking past is safe.
  if(!portal||walker.destination?.nodeId!==portal.nodeId||walker.route.length)return;
  const destination=WORLD.blocks[portal.targetBlock];
  const landing=destination.navigationNodes.find(n=>n.id===portal.targetNode);
  walker.currentBlock=destination.id;walker.currentFloor=destination.floor;
  walker.currentArea=landing.areaId||'area_circulation';walker.currentRoom=landing.roomId;
  walker.currentNode=landing.id;walker.position={x:landing.x+walker.routeOffset.x,y:landing.y+walker.routeOffset.y};
  walker.destination=null;walker.state='IDLE';walker.remaining=1;
  visitControllerFor(walker).transition(walker);
}

export function isMacroPositionWalkable(blockId,p,radius=.24){
  const block=WORLD.blocks[blockId];if(!block||!Number.isFinite(p?.x)||!Number.isFinite(p?.y))return false;
  const b=block.bounds;
  if(p.x<b.x+radius||p.y<b.y+radius||p.x>b.x+b.width-radius||p.y>b.y+b.height-radius)return false;
  if(blockId===INITIAL_BLOCK&&p.x>=0&&p.x<=12&&p.y<9-radius)return isPositionWalkable(p,radius);
  if(blockId===INITIAL_BLOCK&&p.y<11&&p.y>=9-radius){
    // Only the real doorway and exterior corridor are traversable here.
    return (p.y<9+radius&&p.x>=1+radius&&p.x<=2.8-radius)||
      (p.y>=9+radius&&p.y<=10.6&&p.x>=-1.6&&p.x<=2.5)||
      (p.x>=-1.6&&p.x<=-.4&&p.y>=10);
  }
  return !Object.values(block.areas).some(a=>a.theme!=='access'&&a.obstacles?.some(o=>
    p.x>o.x-radius&&p.x<o.x+o.width+radius&&p.y>o.y-radius&&p.y<o.y+o.height+radius));
}
