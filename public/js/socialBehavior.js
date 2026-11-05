import {directionForMovement} from './avatar/lpcConfig.js';
import {sampleVisualVisit} from './visitVisualBehavior.js';

// Visual game encounters only. No relationships, names, traits or persisted social history.
export const SOCIAL_BEHAVIOR={enabled:true,checkIntervalMs:1500,interactionChance:.08,plazaInteractionChance:.16,
  minCooldownMs:10000,maxCooldownMs:30000,minInteractionMs:800,maxInteractionMs:2600,minEmoteInteractionMs:2000,
  minSettleMs:1500,minAttemptGapMs:5000,maxAttemptGapMs:9000,stayMarginMs:600,
  maxDistance:2.6,maxGroupSize:3,maxActiveInteractions:3,maxInteractionsPerBlock:1,
  minStaggerMs:300,maxStaggerMs:800,minLookStaggerMs:80,maxLookStaggerMs:180,
  minEmoteMs:500,maxEmoteMs:800,minJitterMs:100,maxJitterMs:250};
export const SOCIAL_TYPES=['ACKNOWLEDGE','LOOK_AT','WAVE','SHARED_REACTION'];
const emoteTypes=new Set(['WAVE','SHARED_REACTION']);
export function sampleSocialInteraction(plan){
  if(!plan)return {phase:'IDLE',facing:null,emote:null,progress:0};
  const active=plan.elapsedMs>=plan.lookDelayMs&&plan.elapsedMs<plan.durationMs;
  const progress=Math.max(0,Math.min(1,(plan.elapsedMs-plan.emoteDelayMs)/plan.emoteDurationMs));
  return {phase:plan.elapsedMs>=plan.durationMs?'DONE':active?'PLAYING':'WAITING',
    facing:active?plan.facing:null,emote:active&&progress>0&&progress<1?plan.emote:null,progress};
}
// A culled/missing sprite must never leave a one-sided gesture on this display.
export function sampleVisibleSocial(w,participantsById){
  const plan=w.socialInteraction,peer=participantsById?.get(plan?.targetUuid);
  if(w.state!=='VISITING'||w.status==='INACTIVE'||!plan||!peer||peer.state!=='VISITING'||peer.status==='INACTIVE'||
    peer.socialInteraction?.id!==plan.id||peer.visualVisit?.id!==peer.socialInteraction?.visitId||peer.currentBlock!==w.currentBlock||
    peer.currentArea!==w.currentArea||plan.blockId!==w.currentBlock||
    w.visualVisit?.id!==plan.visitId||w.visualVisit?.behavior!=='observe'||peer.visualVisit?.behavior!=='observe'||
    peer.visualVisit?.poiId!==plan.poiId)return sampleSocialInteraction(null);
  return sampleSocialInteraction(plan);
}
export function createSocialController({view,random=Math.random,config={}}){
  const settings={...SOCIAL_BEHAVIOR,...config},states=new WeakMap(),locks=new Map(),pairs=new Map();
  let clock=0,nextCheck=0,sequence=0;
  const metrics={scans:0,comparisons:0,attempts:0,started:0,cancelled:0,completed:0};
  const between=(a,b)=>a+random()*(b-a);
  const state=w=>{if(!states.has(w))states.set(w,{cooldownUntil:0,nextAttempt:0,emoteVisitId:null,nearby:0});return states.get(w);};
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const key=w=>`${w.currentBlock}/${w.currentArea}/${view(w)?.poi?.id}`;
  function eligible(w){
    if(!w||!settings.enabled||w.state!=='VISITING'||w.status==='INACTIVE'||
      (w.experienceStatus&&w.experienceStatus!=='ACTIVE'))return false;
    const v=view(w);
    return !!v?.valid&&v.poi.areaId===w.currentArea&&v.poi.blockId===w.currentBlock&&v.visual?.behavior==='observe'&&
      v.visual.elapsedMs>=settings.minSettleMs&&v.stayMs>=settings.maxInteractionMs+settings.stayMarginMs;
  }
  function finish(pair,cancelled=false){
    if(!pairs.delete(pair.id))return;
    for(const w of pair.people){
      if(locks.get(w)===pair)locks.delete(w);
      state(w).cooldownUntil=clock+between(settings.minCooldownMs,settings.maxCooldownMs);
      w.facing=sampleVisualVisit(view(w)?.visual).facing;
    }
    metrics[cancelled?'cancelled':'completed']++;
  }
  function cancel(w){const pair=locks.get(w);if(pair)finish(pair,true);}
  function packet(w){
    const pair=locks.get(w);if(!pair)return null;
    return {...pair.plans.get(w),elapsedMs:clock-pair.startedAt};
  }
  function compatible(pair,walkers){
    return pair.people.every(w=>walkers.get(w.id)===w&&w.state==='VISITING'&&w.status!=='INACTIVE'&&
      (!w.experienceStatus||w.experienceStatus==='ACTIVE')&&view(w)?.valid&&
      view(w)?.visual?.id===pair.visitIds.get(w)&&view(w)?.visual?.behavior==='observe'&&key(w)===pair.groupKey)&&distance(...pair.people)<=settings.maxDistance;
  }
  function available(w){return eligible(w)&&!locks.has(w)&&state(w).cooldownUntil<=clock;}
  function interact(a,b,{type,force=false}={}){
    if(!a||!b||a===b||!eligible(a)||!eligible(b)||key(a)!==key(b))return {ok:false,code:'INELIGIBLE'};
    if(locks.has(a)||locks.has(b))return {ok:false,code:'LOCKED'};
    if(state(a).cooldownUntil>clock||state(b).cooldownUntil>clock)return {ok:false,code:'COOLDOWN'};
    if(distance(a,b)>settings.maxDistance)return {ok:false,code:'DISTANCE'};
    if(pairs.size>=settings.maxActiveInteractions||[...pairs.values()].filter(p=>p.blockId===a.currentBlock).length>=settings.maxInteractionsPerBlock)
      return {ok:false,code:'LIMIT'};
    const va=view(a),vb=view(b),hasEmoteBudget=state(a).emoteVisitId!==va.visual.id&&state(b).emoteVisitId!==vb.visual.id;
    const types=hasEmoteBudget?SOCIAL_TYPES:SOCIAL_TYPES.filter(t=>!emoteTypes.has(t));
    type=type||types[Math.floor(random()*types.length)];
    if(!SOCIAL_TYPES.includes(type))return {ok:false,code:'TYPE'};
    if(emoteTypes.has(type)&&!hasEmoteBudget)return {ok:false,code:'EMOTE_BUDGET'};
    metrics.attempts++;
    if(!force&&random()>=(va.theme==='plaza'?settings.plazaInteractionChance:settings.interactionChance))return {ok:false,code:'CHANCE'};
    const durationMs=Math.round(between(emoteTypes.has(type)?settings.minEmoteInteractionMs:settings.minInteractionMs,settings.maxInteractionMs));
    const jitter=Math.round(between(settings.minJitterMs,settings.maxJitterMs)),stagger=Math.round(between(settings.minStaggerMs,settings.maxStaggerMs));
    const pair={id:++sequence,people:[a,b],visitIds:new Map([[a,va.visual.id],[b,vb.visual.id]]),
      groupKey:key(a),blockId:a.currentBlock,startedAt:clock,durationMs,plans:new Map()};
    for(const [i,w] of pair.people.entries()){
      const other=pair.people[1-i],dx=other.x-w.x,dy=other.y-w.y;
      const emote=emoteTypes.has(type)?(i?'sparkle':'attention'):null;
      pair.plans.set(w,{id:pair.id,type,targetUuid:other.uuid||other.id,blockId:w.currentBlock,poiId:va.poi.id,
        visitId:view(w).visual.id,durationMs,lookDelayMs:jitter+(i?(emoteTypes.has(type)?stagger:Math.round(between(settings.minLookStaggerMs,settings.maxLookStaggerMs))):0),
        facing:type==='SHARED_REACTION'?view(w).slot.facing:directionForMovement((dx-dy)*2,dx+dy,w.facing),
        emote,emoteDelayMs:jitter+(i?stagger:0),emoteDurationMs:Math.round(between(settings.minEmoteMs,settings.maxEmoteMs))});
      locks.set(w,pair);if(emote)state(w).emoteVisitId=view(w).visual.id;
    }
    pairs.set(pair.id,pair);metrics.started++;return {ok:true,id:pair.id,type};
  }
  function groups(walkers){
    const grouped=new Map();
    for(const w of walkers.values()){
      const v=view(w);if(w.state!=='VISITING'||w.status==='INACTIVE'||!v?.valid)continue;
      const k=key(w);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(w);
    }
    return grouped;
  }
  return {
    register(w){
      state(w);
      Object.defineProperty(w,'socialInteraction',{configurable:true,enumerable:false,get:()=>packet(w)});
      Object.defineProperty(w,'socialTargetUuid',{configurable:true,enumerable:false,get:()=>packet(w)?.targetUuid||null});
    },
    interact,cancel,
    update(walkers,dt){
      clock+=Math.max(0,dt);
      for(const pair of [...pairs.values()]){
        if(!settings.enabled||!compatible(pair,walkers))finish(pair,true);
        else if(clock-pair.startedAt>=pair.durationMs)finish(pair);
      }
      if(!settings.enabled||clock<nextCheck)return;
      nextCheck=clock+settings.checkIntervalMs;metrics.scans++;
      for(const members of groups(walkers).values()){
        // Shuffle once, then examine at most maxGroupSize - 1 neighbors per visitor.
        for(let i=members.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[members[i],members[j]]=[members[j],members[i]];}
        for(let i=0;i<members.length;i++){
          const a=members[i],s=state(a);s.nearby=0;
          if(!available(a)||s.nextAttempt>clock)continue;
          s.nextAttempt=clock+between(settings.minAttemptGapMs,settings.maxAttemptGapMs);
          for(let offset=1;offset<Math.min(settings.maxGroupSize,members.length);offset++){
            const b=members[(i+offset)%members.length];metrics.comparisons++;
            if(distance(a,b)>settings.maxDistance)continue;
            s.nearby++;if(!available(b)||state(b).nextAttempt>clock)continue;
            state(b).nextAttempt=clock+between(settings.minAttemptGapMs,settings.maxAttemptGapMs);
            interact(a,b);break; // One probabilistic offer, never keep rolling until success.
          }
        }
      }
    },
    inspect(w){return {socialState:packet(w)?.type||'NONE',socialTarget:packet(w)?.targetUuid?.slice(0,8)||null,
      socialCooldownMs:Math.max(0,Math.round((states.get(w)?.cooldownUntil||0)-clock)),nearbyParticipants:states.get(w)?.nearby||0};},
    snapshot(walkers){return {metrics:{...metrics,active:pairs.size},groups:[...groups(walkers).values()].filter(g=>g.length>1).map(g=>({
      blockId:g[0].currentBlock,poiId:view(g[0]).poi.id,visitors:g.map(w=>w.id.slice(0,8)),
      clusters:Array.from({length:Math.ceil(g.length/settings.maxGroupSize)},(_,i)=>g.slice(i*settings.maxGroupSize,(i+1)*settings.maxGroupSize).map(w=>w.id.slice(0,8)))}))};},
    clear(){for(const p of [...pairs.values()])finish(p,true);locks.clear();nextCheck=clock+settings.checkIntervalMs;},
    get active(){return pairs.size;},get metrics(){return {...metrics,active:pairs.size};}
  };
}
