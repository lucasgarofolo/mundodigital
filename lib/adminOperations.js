const express=require('express'),fs=require('node:fs/promises'),path=require('node:path');
const {fold}=require('./operatorControl');
const {canDeleteBeforeEntry}=require('./participantDeletion');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issue=(message,status=409,code='INVALID_STATE')=>Object.assign(new Error(message),{status,code});
const FILTERS=new Set(['ALL','ACTIVE','PROCESSING','FAILED','PASS_READY','PORTRAIT_FAILED','LPC_FAILED']);
function attachAdminOperations({app,io,auth,store,walkers,avatarPipeline,passService,selfieLifecycle,entryScheduler,operatorControl,events,
 dataDir,now=Date.now,personalization,configuration,approveEntry,removeParticipant,participantDeletion,isUnavailable=()=>false,logger=()=>{}}){
 const requests=new Map(),started=Date.now();let timer,dirty=new Set(),revision=0,closed=false;
 function notify(uuid){if(closed)return;if(UUID.test(uuid||''))dirty.add(uuid);if(timer)return;
  timer=setTimeout(()=>{timer=null;io.to('admin-operations').emit('admin:updated',{revision:++revision,participantUuids:[...dirty].slice(0,50)});dirty.clear();},500);timer.unref();}
 events.subscribe(notify);
 io.on('connection',socket=>{
  if(socket.handshake.auth.mode==='admin'){socket.join('admin-operations');socket.emit('admin:updated',{revision,participantUuids:[]});}
  if(socket.handshake.auth.mode==='live'){notify();socket.on('disconnect',()=>notify());}
 });
 const settings=()=>({now:now(),portraitWaitMs:Number.isSafeInteger(passService.config.portraitWaitMs)?passService.config.portraitWaitMs:15000,personalization});
 function permissions(p,privacy=selfieLifecycle.inspect(p.uuid,p)){
  const active=p.status!=='INACTIVE',photo=privacy.available,pass=passService.data(p),busy=avatarPipeline.has(p.uuid),portraitBusy=passService.hasSelfieWork(p.uuid);
  const photoReason=p.selfieStatus==='DELETED'||p.selfieDeletedAt?'Selfie original removida. Uma nova foto é necessária.':'Selfie temporária indisponível.';
  const result=(allowed,reason)=>({allowed:!!allowed,reason:allowed?null:reason});
  return {
   locate:result(active&&walkers.has(p.uuid)&&['ACTIVE','ENTERING'].includes(p.experienceStatus),'Participante não está no mundo.'),
   retryLpc:result(active&&personalization&&photo&&!busy&&p.avatarStatus==='FALLBACK'&&p.avatarAttempts<2,
    !photo?photoReason:busy?'Análise em andamento.':p.avatarAttempts>=2?'Limite de tentativas atingido.':'A recuperação LPC requer fallback de análise; avatares READY são preservados.'),
   retryPortrait:result(active&&photo&&!portraitBusy&&p.portraitStatus==='FAILED'&&!!p.portraitRequestedAt&&p.portraitAttempts<2,
    !photo?photoReason:portraitBusy?'Portrait em andamento.':p.portraitAttempts>=2?'Limite de tentativas atingido.':'O estado atual não permite repetir o portrait.'),
   regenerateStory:result(!!p.passNumber&&pass.shareAllowed&&['READY','FALLBACK'].includes(p.avatarStatus)&&!passService.hasStoryWork(p.uuid),'Aguarde a entrada e os assets, ou a exportação em andamento.'),
   forceEntry:result(active&&!!p.passNumber&&pass.canEnter,'A entrada requer PASS_READY; entradas já agendadas ou iniciadas não são duplicadas.'),
   cancelEntry:result(active&&p.experienceStatus==='AVATAR_APPROVED','Somente uma entrada agendada pode ser cancelada.'),
   remove:result(active&&['ACTIVE','ENTERING'].includes(p.experienceStatus)&&walkers.has(p.uuid),'Participante não está ativo no mundo.'),
   deleteRegistration:result(canDeleteBeforeEntry(p)&&!walkers.has(p.uuid)&&!participantDeletion.isDeleting(p.uuid),
    participantDeletion.isDeleting(p.uuid)?'Exclusão em andamento.':'Somente cadastros que ainda não iniciaram a entrada podem ser excluídos. Para avatares no mundo, use REMOVER DO MUNDO.'),
   retryDelete:result(p.selfieStatus==='DELETE_FAILED'&&privacy.terminal&&!privacy.busy,'A exclusão requer falha anterior e término de todos os consumidores da selfie.')
  };
 }
 function dto(p,detail=false){const w=walkers.get(p.uuid),privacy=selfieLifecycle.inspect(p.uuid,p),finished=Math.max(...[p.avatarSelfieFinishedAt,p.portraitSelfieFinishedAt].map(t=>Date.parse(t)||0));
  const data={uuid:p.uuid,name:p.name,status:p.status==='INACTIVE'?'INACTIVE':passService.data(p).credentialState,
   experienceStatus:p.experienceStatus,avatarStatus:p.avatarStatus,portraitStatus:p.portraitStatus,selfieStatus:p.selfieStatus||'UNAVAILABLE',storyStatus:p.storyStatus,
   currentBlock:w?.currentBlock||p.currentBlock,currentArea:w?.currentArea||p.currentArea,scheduledEntryAt:p.scheduledEntryAt,enteredAt:p.enteredAt,
   cleanupWaiting:!!p.photoPath&&privacy.terminal&&!privacy.busy&&finished>0&&now()-finished>120000,
   actions:permissions(p,privacy)};
  if(detail)Object.assign(data,{passNumber:p.passNumber,checkinAt:p.checkinAt,approvedAt:p.approvedAt,avatarAttempts:p.avatarAttempts,portraitAttempts:p.portraitAttempts,
   selfieDeletedAt:p.selfieDeletedAt,lastError:events.error(p.uuid),
   assets:{avatar:/^\/avatars\/[0-9a-f-]{36}(?:-[0-9a-f]{16})?\.png$/i.test(p.avatar)?p.avatar:null,
    portrait:p.portraitStatus==='READY'?`/generated/participants/${p.uuid}/portrait.png`:null,
    story:passService.data(p).storyUrl,pass:p.passNumber?`/pass/${p.uuid}`:null}});
  return data;
 }
 function service(name,configured,enabled=true){const observation=events.service(name);let status=!enabled?'INATIVO':!configured?'NAO_CONFIGURADO':'CONFIGURADO';
  if(enabled&&(observation.lastSuccess||observation.lastError))status=observation.lastOutcome==='error'?'WARNING':'OK';
  return {status,configured,...observation};}
 function summary(){let counters=null,database='OK';try{counters=store.adminSummary(settings());}catch{database='ERROR';}
  const config=configuration();return {at:new Date(now()).toISOString(),revision:events.revision,counters,
   system:{server:{status:'OK',uptimeSeconds:Math.floor((Date.now()-started)/1000)},database:{status:database},
    socket:{status:'OK',connections:io.sockets.sockets.size},tv:{status:io.sockets.adapter.rooms.get('live')?.size?'ONLINE':'OFFLINE',connections:io.sockets.adapter.rooms.get('live')?.size||0},
    openrouter:service('OpenRouter',config.openrouter,config.provider==='openrouter'),cloudflare:service('Cloudflare',config.cloudflare),
    selfie:{status:!counters?'UNKNOWN':counters.selfieDeleteFailed?'WARNING':'OK',activeConsumers:selfieLifecycle.activeLeases,deleteFailed:counters?.selfieDeleteFailed??null}},
   queues:{lpc:avatarPipeline.stats,...passService.stats,entryScheduled:entryScheduler.size},activity:events.activity()};}
 function find(uuid){if(!UUID.test(uuid))throw issue('UUID inválido.',400);const p=store.findByUuid(uuid);if(!p)throw issue('Participante não encontrado.',404);return p;}
 const gate=[auth.requireAdmin,(req,res,next)=>{res.set('Cache-Control','no-store');next();}];
 app.get('/api/admin/operations',...gate,(_req,res)=>res.json(summary()));
 app.get('/api/admin/participants',...gate,(req,res)=>{
  const query=req.query.q??'',filter=req.query.filter??'ALL',page=Number(req.query.page??1),limit=Number(req.query.limit??25);
  if(typeof query!=='string'||query.length>80||!FILTERS.has(filter)||!Number.isSafeInteger(page)||page<1||page>10000||![25,50].includes(limit)){res.status(400).json({error:'Busca, filtro ou página inválidos.'});return;}
  const result=store.adminParticipants({...settings(),query:fold(query.trim()),filter,page,limit});res.json({total:result.total,page,limit,participants:result.participants.map(p=>dto(p))});
 });
 app.get('/api/admin/participants/:uuid',...gate,(req,res,next)=>{try{res.json({participant:dto(find(req.params.uuid),true)});}catch(e){next(e);}});
 async function withPhoto(uuid,fn){const p=find(uuid);if(p.selfieStatus==='DELETED'||!p.photoPath)throw issue('Selfie original removida. Uma nova foto é necessária.');
  if(p.photoPath!==`photos/${uuid}.png`)throw issue('Selfie temporária indisponível.');const release=selfieLifecycle.acquire(uuid);
  try{try{await fs.access(path.join(dataDir,p.photoPath));}catch{throw issue('Selfie temporária indisponível. Uma nova foto é necessária.');}return fn(find(uuid));}finally{release();}}
 const ACTIONS={
  locate:{permission:'locate',audit:'FOCUS_PARTICIPANT',run:p=>{const result=operatorControl.focus(p.uuid);if(!result.ok)throw issue(result.error);return 'Participante localizado na TV.';}},
  'retry-lpc':{permission:'retryLpc',audit:'RETRY_LPC',run:p=>withPhoto(p.uuid,current=>{if(!permissions(current).retryLpc.allowed||!store.retryAvatar(p.uuid))throw issue('O estado atual não permite repetir a análise LPC.');avatarPipeline.enqueue(p.uuid);return 'Avatar encaminhado à fila existente.';})},
  'retry-portrait':{permission:'retryPortrait',audit:'RETRY_PORTRAIT',run:p=>withPhoto(p.uuid,current=>{if(!permissions(current).retryPortrait.allowed||!passService.retry(p.uuid))throw issue('O estado atual não permite repetir o portrait.');return 'Portrait encaminhado à fila existente.';})},
  'regenerate-story':{permission:'regenerateStory',audit:'REGENERATE_STORY',run:p=>{if(!passService.regenerateStory(p.uuid))throw issue('Story já está em processamento ou indisponível.');return 'Story encaminhado para regeneração, sem IA.';}},
  'force-entry':{permission:'forceEntry',audit:'FORCE_ENTRY',run:p=>{approveEntry(p.uuid);return 'Entrada agendada.';}},
  'cancel-entry':{permission:'cancelEntry',audit:'CANCEL_ENTRY',confirm:true,run:p=>{if(!store.cancelEntry(p.uuid,now()))throw issue('A entrada já mudou de estado.');entryScheduler.cancel(p.uuid);events.changed(p.uuid);return 'Entrada cancelada. O passe voltou à revisão disponível.';}},
  remove:{permission:'remove',audit:'REMOVE_FROM_WORLD',confirm:true,run:p=>{removeParticipant(p.uuid);return 'Participante removido do mundo. Cadastro e assets preservados.';}},
  'delete-registration':{permission:'deleteRegistration',audit:'DELETE_PARTICIPANT',confirm:true,run:async p=>{await participantDeletion.delete(p.uuid);return 'Cadastro e arquivos excluídos. O e-mail pode ser utilizado novamente.';}},
  'retry-selfie-delete':{permission:'retryDelete',audit:'RETRY_SELFIE_DELETE',run:async p=>{if(!await selfieLifecycle.request(p.uuid))throw issue('Não foi possível remover a selfie agora. Verifique o status e tente novamente.');return 'Selfie temporária removida.';}}
 };
 async function action(req,res,uuid,actionName){
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['requestId','confirm'].includes(k))||typeof body.requestId!=='string'||!UUID.test(body.requestId)||body.confirm!==undefined&&typeof body.confirm!=='boolean'){res.status(400).json({error:'Informe uma identificação válida da ação.'});return;}
  const key=req.authUser.id+':'+body.requestId,scope=uuid+':'+actionName;const old=requests.get(key);
  if(old&&old.expires>Date.now()){if(old.scope!==scope){res.status(409).json({error:'Identificação já utilizada em outra ação.'});return;}const result=await old.promise;res.status(result.status).json(result.body);return;}
  for(const [k,v]of requests)if(v.expires<Date.now())requests.delete(k);
  if(requests.size>=256){res.status(429).json({error:'Muitas ações recentes. Aguarde alguns instantes.'});return;}
  const record={scope,expires:Date.now()+300000};record.promise=Promise.resolve().then(async()=>{try{
   if(isUnavailable())throw issue('Aguarde a reinicialização ou limpeza do sistema.');
   const definition=actionName==='home'&&uuid===''?{audit:'GO_HOME',run:()=>{operatorControl.goHome();return 'Câmera na Sala de Acesso.';}}:Object.hasOwn(ACTIONS,actionName)?ACTIONS[actionName]:null;
   if(!definition)throw issue('Ação inválida.',400);const p=actionName==='home'?null:find(uuid);
   if(definition.confirm&&body.confirm!==true)throw issue('Confirme esta ação.',400);
   if(p&&!permissions(p)[definition.permission].allowed)throw issue(permissions(p)[definition.permission].reason);
   const message=await definition.run(p);
   logger('admin:action',{timestamp:new Date(now()).toISOString(),adminId:req.authUser.id,username:req.authUser.username,participantUuid:p?.uuid||null,action:definition.audit});
   events.changed(p?.uuid);return {status:200,body:{ok:true,message,uuid:p?.uuid||null}};
  }catch(e){return {status:[400,404,409].includes(e.status)?e.status:500,body:{error:e.status&&e.status<500?e.message:'Não foi possível concluir a ação.',code:e.status&&e.status<500?'ACTION_REJECTED':'OPERATION_FAILED'}};}});
  requests.set(key,record);const result=await record.promise;res.status(result.status).json(result.body);
 }
 app.post('/api/admin/participants/:uuid/actions/:action',...gate,express.json({limit:'2kb'}),(req,res)=>action(req,res,req.params.uuid,req.params.action));
 app.post('/api/admin/camera/home',...gate,express.json({limit:'2kb'}),(req,res)=>action(req,res,'', 'home'));
 return {notify,summary,close(){closed=true;clearTimeout(timer);events.subscribe(()=>{});requests.clear();}};
}
module.exports={attachAdminOperations};
