// Gameplay only. These short-lived plans describe game gestures, never a person's emotions.
export const VISUAL_BEHAVIOR={enabled:true,maxActiveEmotes:8,maxActiveMachines:2,
  minDelayRatio:.2,maxDelayRatio:.45,minDurationMs:1400,maxDurationMs:2400,
  emoteOffsetX:38,emoteOffsetY:-70,emoteDepth:1600,trackingNameDepth:1602};
export const EMOTES=['attention','curious','sparkle','thinking'];
const profiles={
  access:{behaviors:['observe','lookAround'],behaviorWeights:{observe:.85,lookAround:.15}},
  plaza:{behaviors:['observe','lookAround','curious'],behaviorWeights:{observe:.65,lookAround:.25,curious:.1}},
  innovation:{behaviors:['observe','curious','machineDemo'],behaviorWeights:{observe:.6,curious:.25,machineDemo:.15}},
  industrial:{behaviors:['observe','inspect'],behaviorWeights:{observe:.8,inspect:.2}},
  machine:{behaviors:['observe','curious','machineDemo'],behaviorWeights:{observe:.7,curious:.2,machineDemo:.1}},
};
const machines={robot:'robotArmDemo',printer:'printerDemo',cnc:'cncDemo',crane:'craneDemo'};
export function poiVisualSettings(theme){
  const profile=theme==='access'||theme==='plaza'?profiles[theme]:
    ['robot','printer','laser'].includes(theme)?profiles.innovation:
    machines[theme]?profiles.machine:['lathe','mill','injection','tools'].includes(theme)?profiles.industrial:null;
  // A laser has no demo yet: unsupported actions always fall back to observe.
  return {...(profile||{behaviors:['observe']}),machineAnimation:machines[theme]||null};
}
export function createVisualVisit(poi,facing,stayMs,random=Math.random,id=0,config=VISUAL_BEHAVIOR){
  const choices=(poi.behaviors||['observe']).filter(b=>(poi.behaviorWeights?.[b]??1)>0);
  let draw=random()*choices.reduce((sum,b)=>sum+(poi.behaviorWeights?.[b]??1),0),behavior=choices.at(-1)||'observe';
  for(const b of choices){draw-=poi.behaviorWeights?.[b]??1;if(draw<0){behavior=b;break;}}
  if(!config.enabled||!['observe','lookAround','curious','inspect','machineDemo'].includes(behavior)||behavior==='inspect'||
    (behavior==='machineDemo'&&!poi.machineAnimation))behavior='observe';
  const directions=['up','right','down','left'],mainFacing=directions.includes(facing)?facing:'down';
  const secondaryFacing=directions[(directions.indexOf(mainFacing)+(random()<.5?1:3))%4];
  return {id,poiId:poi.id,blockId:poi.blockId,behavior,mainFacing,secondaryFacing,
    emote:behavior==='curious'?EMOTES[Math.floor(random()*EMOTES.length)]:null,
    machineAnimation:behavior==='machineDemo'?poi.machineAnimation:null,
    delayMs:Math.round(stayMs*(config.minDelayRatio+random()*(config.maxDelayRatio-config.minDelayRatio))),
    durationMs:Math.round(Math.min(stayMs*.4,config.minDurationMs+random()*(config.maxDurationMs-config.minDurationMs))),elapsedMs:0};
}
export function sampleVisualVisit(plan){
  if(!plan)return {phase:'IDLE',facing:null,emote:null,machineAnimation:null,progress:0};
  const progress=Math.max(0,Math.min(1,(plan.elapsedMs-plan.delayMs)/plan.durationMs));
  const phase=plan.behavior==='observe'?'IDLE':plan.elapsedMs<plan.delayMs?'WAITING':progress<1?'PLAYING':'DONE';
  const playing=phase==='PLAYING';
  return {phase,progress,facing:playing&&plan.behavior==='lookAround'&&progress<.7?plan.secondaryFacing:plan.mainFacing,
    emote:playing?plan.emote:null,machineAnimation:playing?plan.machineAnimation:null};
}
