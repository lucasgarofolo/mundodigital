const CODES=new Set(`OPENROUTER_NOT_CONFIGURED OPENROUTER_TIMEOUT OPENROUTER_AUTH_ERROR OPENROUTER_QUOTA OPENROUTER_UNAVAILABLE OPENROUTER_API_ERROR OPENROUTER_INVALID_RESPONSE OPENROUTER_REFUSED OPENROUTER_TRUNCATED GEMINI_NOT_CONFIGURED GEMINI_TIMEOUT GEMINI_API_ERROR GEMINI_UNAVAILABLE GEMINI_QUOTA OLLAMA_TIMEOUT OLLAMA_API_ERROR OLLAMA_UNAVAILABLE INVALID_JSON INVALID_APPEARANCE PHOTO_MISSING SELFIE_REMOVED AVATAR_ATTEMPT_LIMIT AVATAR_PROCESSING_ERROR PORTRAIT_NOT_CONFIGURED PORTRAIT_MODEL_INVALID PORTRAIT_HTTP_ERROR PORTRAIT_INVALID_RESPONSE PORTRAIT_REQUEST_FAILED GENERATION_ERROR STORY_RENDER_FAILED EACCES EPERM EBUSY EIO ENOENT UNSAFE_SELFIE_PATH SELFIE_DELETE_ERROR SELFIE_STATE_ERROR`.split(' '));
for(const code of ['PORTRAIT_TIMEOUT','PORTRAIT_NETWORK_ERROR','PORTRAIT_QUOTA','PORTRAIT_INVALID_IMAGE','PORTRAIT_ABORTED','STORY_BROWSER_MISSING','STORY_BROWSER_DEPENDENCIES','STORY_BROWSER_LAUNCH_FAILED','STORY_BROWSER_CLOSED','STORY_RENDER_TIMEOUT','STORY_ASSET_MISSING','STORY_STORAGE_ERROR'])CODES.add(code);
const LABELS={
 'participant:registered':'Check-in concluído','participant:entry-scheduled':'Entrada agendada','participant:entry-started':'Entrada iniciada','participant:active':'Entrou no mundo',
 'avatar:generation-completed':'LPC pronto','avatar:fallback-used':'LPC em fallback','portrait:ready':'Portrait pronto',
 'portrait:failed':'Falha no portrait','story:generated':'Story gerado','story:generation-failed':'Falha no Story',
 'selfie:deleted':'Selfie temporária removida','selfie:deletion-failed':'Falha na exclusão da selfie',
 'admin:action':'Ação administrativa','participants:cleared':'Participantes limpos'};
function createOperationEvents({now=Date.now,resolve=()=>null}={}){
 const recent=[],errors=new Map(),services={OpenRouter:{},Cloudflare:{}},starts=new Map();let listener=()=>{},revision=0,totalCost;
 const changed=uuid=>{revision++;listener(uuid);};
 const fail=(details,service)=>({service,code:CODES.has(details.code)?details.code:'PROCESSING_ERROR',
  ...(Number.isInteger(details.status)&&details.status>=400&&details.status<=599?{status:details.status}:{}),at:new Date(now()).toISOString()});
 function record(event,details={}){
  if(typeof event!=='string')return;
  let participant=null;
  if(typeof details.ref==='string'&&/^[0-9a-f]{8}$/i.test(details.ref)){try{participant=resolve(details.ref);}catch{}}
  if(typeof details.participantUuid==='string'&&/^[0-9a-f-]{36}$/i.test(details.participantUuid)){try{participant=resolve(details.participantUuid);}catch{}}
  const uuid=participant?.uuid||(event==='admin:action'&&details.action==='DELETE_PARTICIPANT'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.participantUuid||'')?details.participantUuid:null),at=new Date(now()).toISOString();
  const service=event.startsWith('portrait:')?(details.provider==='openrouter'?'OpenRouter':'Cloudflare'):event.startsWith('selfie:')?'Selfie Cleanup':event.startsWith('story:')?'Story':'LPC';
  if(event.startsWith('portrait:provider-')&&['cloudflare','openrouter'].includes(details.provider)){
   const target=services[service];
   if(event==='portrait:provider-started')target.lastAttempt=at;
   if(event==='portrait:provider-ready'){target.lastSuccess=at;target.lastOutcome='success';}
   if(event==='portrait:provider-failed'){target.lastError=fail(details,service);target.lastOutcome='error';}
   if(Number.isFinite(details.duration_ms)&&details.duration_ms>=0)target.durationMs=details.duration_ms;
   if(typeof details.cost==='number'&&Number.isFinite(details.cost)&&details.cost>=0){
    target.lastCost=details.cost;
    if(service==='OpenRouter'){totalCost=(totalCost??0)+details.cost;target.sessionCost=totalCost;}
    else target.sessionCost=(target.sessionCost??0)+details.cost;
   }
   changed();
  }
  if(event==='portrait:processing-started'&&!details.managedProvider){services.Cloudflare.lastAttempt=at;starts.set('portrait:'+details.ref,now());if(starts.size>1000)starts.delete(starts.keys().next().value);}
  if((event==='portrait:ready'||event==='portrait:failed')&&!details.managedProvider){
   const started=starts.get('portrait:'+details.ref);if(started!==undefined)services.Cloudflare.durationMs=now()-started;starts.delete('portrait:'+details.ref);
   if(event==='portrait:ready'){services.Cloudflare.lastSuccess=at;services.Cloudflare.lastOutcome='success';}else{services.Cloudflare.lastError=fail(details,service);services.Cloudflare.lastOutcome='error';}
  }
  if(['avatar:fallback-used','portrait:failed','portrait:job-failed','story:generation-failed','selfie:deletion-failed'].includes(event)&&uuid){
   errors.delete(uuid);errors.set(uuid,fail(details,service));if(errors.size>1000)errors.delete(errors.keys().next().value);
  }
  if(LABELS[event]){
   const actions=new Set(['FORCE_ENTRY','CANCEL_ENTRY','REMOVE_FROM_WORLD','DELETE_PARTICIPANT','RETRY_LPC','RETRY_PORTRAIT','REGENERATE_STORY','RETRY_SELFIE_DELETE','FOCUS_PARTICIPANT','GO_HOME']);
   const item={id:++revision,at,event,label:LABELS[event],uuid,name:participant?.name||null,
    ...(CODES.has(details.code)?{code:details.code}:{}),...(Number.isInteger(details.status)?{status:details.status}:{}),
    ...(event==='admin:action'&&actions.has(details.action)?{action:details.action,admin:typeof details.username==='string'&&/^[a-z0-9._-]{3,64}$/i.test(details.username)?details.username:null}:{})};
   recent.unshift(item);if(recent.length>50)recent.pop();
  }
  if(LABELS[event]||event==='portrait:processing-started'||event==='avatar:analysis-started'||event==='avatar:analysis-retrying')changed(uuid);
 }
 function providerLog(message){
  if(typeof message!=='string'||message.length>4096)return;
  const match=/^\[OpenRouter\] (request|completed|failed) (\{.*\})$/.exec(message);if(!match)return;
  let data;try{data=JSON.parse(match[2]);}catch{return;}
  const service=services.OpenRouter,at=new Date(now()).toISOString();
  if(match[1]==='request')service.lastAttempt=at;
  if(match[1]==='completed'){service.lastSuccess=at;service.lastOutcome='success';
   if(typeof data.cost==='number'&&Number.isFinite(data.cost)&&data.cost>=0){service.lastCost=data.cost;totalCost=(totalCost??0)+data.cost;service.sessionCost=totalCost;}}
  if(match[1]==='failed'){service.lastError=fail({code:data.code,status:data.status??data.http_status},'OpenRouter');service.lastOutcome='error';}
  if(typeof data.duration_ms==='number'&&Number.isFinite(data.duration_ms)&&data.duration_ms>=0)service.durationMs=data.duration_ms;
  changed();
 }
 return {record,providerLog,changed,subscribe(fn){listener=fn;},get revision(){return revision;},
  activity:()=>recent.map(e=>({...e})),error:uuid=>errors.get(uuid)||null,service:name=>({...services[name]}),clearParticipantErrors(){errors.clear();starts.clear();}};
}
module.exports={createOperationEvents};
