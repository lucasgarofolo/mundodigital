const express=require('express');
const path=require('node:path');
const fs=require('node:fs/promises');
const http=require('node:http');
const {randomUUID,timingSafeEqual}=require('node:crypto');
const multer=require('multer');
const {Server}=require('socket.io');
const {createStore}=require('./lib/store');
const {validateSelfie,MAX_SELFIE_BYTES}=require('./lib/avatarGenerator');
const {DEFAULT_AVATAR}=require('./lib/avatarCatalog');
const {composeAvatar}=require('./lib/lpcAvatarBuilder');
const {createGeminiAvatarAnalyzer,geminiConfig}=require('./lib/geminiAvatarAnalyzer');
const {createOllamaAvatarAnalyzer,ollamaConfig}=require('./lib/ollamaAvatarAnalyzer');
const {createOpenRouterAvatarAnalyzer,openRouterConfig}=require('./lib/openRouterAvatarAnalyzer');
const {createAvatarPipeline}=require('./lib/avatarPipeline');
const {experienceConfig}=require('./lib/experienceConfig');
const {createEntryScheduler}=require('./lib/entryScheduler');
const {createPassService}=require('./lib/passService');
const {attachPassRoutes}=require('./lib/passRoutes');
const {createOperatorControl}=require('./lib/operatorControl');
const {createSelfieLifecycle,SELFIE_NOTICE_VERSION}=require('./lib/selfieLifecycle');
const {createAuth}=require('./lib/auth');
const {createOperationEvents}=require('./lib/operationEvents');
const {attachAdminOperations}=require('./lib/adminOperations');
const {portraitConfig}=require('./lib/cloudflarePortrait');

// A strict allowlist: private email, selfie and simulation internals never reach the display.
function publicParticipant(w) {
  return {id:w.id,uuid:w.uuid||w.id,name:w.name,avatar:w.avatar,avatarUrl:w.avatar,avatarKind:w.avatarKind,status:w.status==='INACTIVE'?'INACTIVE':w.experienceStatus||w.status,
    checkinAt:w.checkinAt,updatedAt:w.updatedAt,currentFloor:w.currentFloor,
    currentRoom:w.currentRoom,currentBlock:w.currentBlock||'blockB_upper',currentArea:w.currentArea||'area_access',
    position:{...w.position},x:w.x,y:w.y,state:w.state,facing:w.facing||null,visualVisit:w.visualVisit||null,socialInteraction:w.socialInteraction||null,
    createdAt:w.createdAt,cycleId:w.cycleId,avatarType:w.avatarType||(w.avatarKind==='lpc'?'lpc':'placeholder'),
    avatarStatus:w.avatarStatus||'FALLBACK',avatarVersion:w.avatarVersion||null};
}
function validateIdentity(body) {
  const name=typeof body.name==='string'?body.name.trim().replace(/\s+/gu,' '):'';
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(name.length<2||name.length>60||/[\p{Cc}<>]/u.test(name)) throw Object.assign(new Error('Informe um nome entre 2 e 60 caracteres.'),{status:400});
  if(email.length>254||!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email)) throw Object.assign(new Error('Informe um e-mail com formato válido.'),{status:400});
  return {name,email};
}

async function createApplication(options={}) {
  const {createWalker:createBaseWalker,updateWalker}=await import('./public/js/movement.js');
  const {createVisitController}=await import('./public/js/macroNavigation.js');
  const visitController=createVisitController({socialConfig:options.socialConfig});
  const createWalker=(data,index,settings)=>createBaseWalker({...data,allowExploration:true},index,{...settings,visitController});
  const configuredDataDir=options.dataDir||process.env.DATA_DIR;
  if(process.env.NODE_ENV==='production'&&!configuredDataDir)throw new Error('Configure DATA_DIR no volume persistente antes de iniciar em produção.');
  const dataDir=path.resolve(configuredDataDir||path.join(__dirname,'data'));
  await fs.mkdir(dataDir,{recursive:true});
  // Private SQLite/session/selfie storage must never be published by express.static,
  // including a path redirected into public through a symbolic link.
  const [realDataDir,realPublicDir]=await Promise.all([fs.realpath(dataDir),fs.realpath(path.join(__dirname,'public'))]);
  const publicRelative=path.relative(realPublicDir,realDataDir);
  if(publicRelative===''||!publicRelative.startsWith('..'+path.sep)&&publicRelative!=='..'&&!path.isAbsolute(publicRelative))
    throw new Error('DATA_DIR deve ficar fora do diretório público.');
  const avatarDir=path.join(dataDir,'avatars'),photoDir=path.join(dataDir,'photos');
  await fs.mkdir(avatarDir,{recursive:true});await fs.mkdir(photoDir,{recursive:true});
  const provider=options.avatarProvider||process.env.AVATAR_PROVIDER||'local';
  if(!['local','gemini','ollama','openrouter'].includes(provider))throw new Error('Use AVATAR_PROVIDER=local, gemini, ollama ou openrouter.');
  const personalization=provider!=='local'||!!options.analyzeSelfie;
  // Prepare the local LPC once. Emergency fallback is the approved Phase 4.0 sheet.
  const defaultSprite=options.generateAvatar?null:await composeAvatar(DEFAULT_AVATAR)
    .catch(()=>fs.readFile(path.join(__dirname,'public/assets/avatars/lpc/test-avatar.png')));
  const generate=options.generateAvatar||(()=>({buffer:defaultSprite,kind:'lpc'}));
  const now=options.now||Date.now;
  const experience={...experienceConfig(),...(options.entryDelayMs!==undefined?{entryDelayMs:options.entryDelayMs}:{}),
    ...(options.entrySpacingMs!==undefined?{entrySpacingMs:options.entrySpacingMs}:{})};
  let store,operations;
  const operationEvents=createOperationEvents({now,resolve:ref=>store?.adminResolveRef(ref)||null});
  const writeLog=options.logger||((event,details={})=>console.log(`[Mundo // Digital] ${event}`,JSON.stringify(details)));
  const log=(event,details={})=>{writeLog(event,details);operationEvents.record(event,details);};
  const app=express();app.disable('x-powered-by');
  const server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:10000});
  const auth=createAuth({app,io,dataDir,logger:log,config:options.authConfig});
  try{store=createStore(dataDir);}catch(error){auth.close();log('database:error',{code:error.code||'DATABASE_ERROR'});throw error;}
  log('database:connected');
  const walkers=new Map(store.listActive().map((data,index)=>[data.id,createWalker(data,index)]));
  log('participants:restored',{count:walkers.size});
  const pending=new Map(),displayed=new Map();
  let avatarPipeline,passService;
  const selfieLifecycle=createSelfieLifecycle({store,dataDir,walkers,logger:log,now,
    ...(options.selfieCleanupOptions||{}),
    isBusy:uuid=>!!avatarPipeline?.has(uuid)||!!passService?.hasSelfieWork(uuid),
    canSweepOrphans:()=>pending.size===0&&processing===0&&!avatarPipeline.stats.running&&!avatarPipeline.stats.queued&&!passService.selfieJobs});
  const operatorControl=createOperatorControl({app,io,store,walkers,now,auth});
  const analyzers={local:{config:geminiConfig,create:createGeminiAvatarAnalyzer,timeoutCode:'GEMINI_TIMEOUT'},
    gemini:{config:geminiConfig,create:createGeminiAvatarAnalyzer,timeoutCode:'GEMINI_TIMEOUT'},
    ollama:{config:ollamaConfig,create:createOllamaAvatarAnalyzer,timeoutCode:'OLLAMA_TIMEOUT'},
    openrouter:{config:openRouterConfig,create:createOpenRouterAvatarAnalyzer,timeoutCode:'OPENROUTER_TIMEOUT'}};
  const analyzer=analyzers[provider],analyzerConfig=analyzer.config();
  const analysisTimeoutMs=options.avatarTimeoutMs??analyzerConfig.timeoutMs;
  log('avatar:provider-configured',{provider,model:analyzerConfig.model,keyConfigured:!!analyzerConfig.apiKey,timeoutMs:analysisTimeoutMs});
  avatarPipeline=createAvatarPipeline({store,dataDir,walkers,logger:log,now,selfieLifecycle,
    analyzeSelfie:options.analyzeSelfie||analyzer.create({config:{...analyzerConfig,timeoutMs:analysisTimeoutMs},logger:message=>{console.log(message);operationEvents.providerLog(message);}}),build:options.buildLpcAvatar,
    concurrency:provider==='ollama'?1:2,timeoutCode:analyzer.timeoutCode,
    timeoutMs:analysisTimeoutMs,onUpdated:payload=>{if(walkers.has(payload.uuid))io.to('live').emit('participant:avatar-updated',payload);}});
  const entryScheduler=createEntryScheduler({store,walkers,createWalker,now,spacingMs:experience.entrySpacingMs,logger:log,
    onEnter:walker=>io.to('live').emit('participant:enter',publicParticipant(walker))});
  passService=createPassService({store,dataDir,logger:log,generatePortrait:options.generatePortrait,renderer:options.storyRenderer,selfieLifecycle,
    config:options.passConfig,retryDelayMs:options.portraitRetryDelayMs});
  // READY is never analyzed again. Only interrupted, persisted PENDING jobs resume.
  for(const participant of store.listRegistered())if(participant.avatarStatus==='PENDING'){
    if(personalization)avatarPipeline.enqueue(participant.uuid);
    else {
      store.updateAvatar(participant.uuid,{avatarStatus:'FALLBACK',appearance:DEFAULT_AVATAR},now());
      selfieLifecycle.finish(participant.uuid,'avatar');
      if(walkers.has(participant.uuid))Object.assign(walkers.get(participant.uuid),{avatarStatus:'FALLBACK'});
    }
  }
  if(!personalization)for(const p of store.listRegistered())if(['READY','FALLBACK','FAILED'].includes(p.avatarStatus))selfieLifecycle.finish(p.uuid,'avatar');
  // SQLite determines membership/identity; in-memory walkers supply current live coordinates.
  const snapshot=()=>({participants:store.listActive().map(data=>publicParticipant({...data,...walkers.get(data.id),facing:walkers.get(data.id)?.facing||null,
    visualVisit:walkers.get(data.id)?.visualVisit||null,socialInteraction:walkers.get(data.id)?.socialInteraction||null})),
    cycle:store.cycle(now()),serverTime:now(),provisional:!personalization,camera:operatorControl.state()});
  io.on('connection',socket=>{
    if(['operator','admin'].includes(socket.handshake.auth.mode))return;
    if(socket.handshake.auth.mode!=='live'){socket.disconnect(true);return;}
    socket.join('live');log('socket:connected',{id:socket.id});
    if(socket.handshake.auth.debugWorld===true&&process.env.NODE_ENV!=='production')socket.join('debug-world');
    if(socket.rooms.has('debug-world'))socket.on('world:social-force',(request,respond)=>{
      const reply=typeof respond==='function'?respond:()=>{};
      const host=socket.handshake.headers.host,origin=socket.handshake.headers.origin;
      let sameOrigin=false;try{sameOrigin=!origin||new URL(origin).host===host;}catch{}
      if(process.env.NODE_ENV==='production'||!sameOrigin||
        !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(socket.request.socket.remoteAddress))return reply({ok:false,code:'FORBIDDEN'});
      if(!request||![request.a,request.b].every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)))return reply({ok:false,code:'INVALID_REQUEST'});
      reply(visitController.social.interact(walkers.get(request.a),walkers.get(request.b),{type:request.type||'ACKNOWLEDGE',force:true}));
    });
    socket.emit('camera:state',operatorControl.state());
    socket.on('disconnect',reason=>log('socket:disconnected',{id:socket.id,reason}));
    socket.on('participant:displayed',id=>{if(typeof id==='string'&&walkers.has(id)) displayed.set(id,now());});
  });
  const socialStatesSent=new Map();
  let lastTick=Date.now(),lastSave=Date.now(),lastOperatorUpdate=0,closed=false,lastDatabaseError=0,resettingParticipants=false,resetTask=null;
  const canResetParticipants=req=>!!auth.userFor(req);
  const checkpoint=()=>{
    try{store.save([...walkers.values()],now());return true;}
    catch(error){if(Date.now()-lastDatabaseError>30000){log('database:error',{code:error.code||'DATABASE_ERROR'});lastDatabaseError=Date.now();}return false;}
  };
  const timer=setInterval(()=>{
    const time=Date.now(),delta=Math.min(time-lastTick,100);lastTick=time;
    const changed=[],significant=[];
    visitController.reconcile(walkers);
    visitController.social.update(walkers,delta);
    for(const id of socialStatesSent.keys())if(!walkers.has(id))socialStatesSent.delete(id);
    for(const walker of walkers.values()) {
      const {x,y}=walker.position,state=walker.state,room=walker.currentRoom,block=walker.currentBlock,area=walker.currentArea,
        facing=walker.facing,visualPhase=visitController.info(walker).phase;
      updateWalker(walker,delta,visitController);
      if(state==='ENTERING'&&walker.state!=='ENTERING'){
        walker.experienceStatus='ACTIVE';walker.enteredAt=new Date(now()).toISOString();
        try{store.save([walker],now());}catch{log('database:error',{code:'ENTRY_CHECKPOINT_ERROR'});}
        log('participant:active',{ref:walker.uuid.slice(0,8)});
      }
      if(block!==walker.currentBlock||area!==walker.currentArea||(state==='WALKING'&&walker.state==='VISITING'))significant.push(walker);
      const socialInteraction=walker.socialInteraction,socialId=socialInteraction?.id||null;
      if(x!==walker.x||y!==walker.y||state!==walker.state||room!==walker.currentRoom||block!==walker.currentBlock||
        facing!==walker.facing||visualPhase!==visitController.info(walker).phase||socialStatesSent.get(walker.id)!==socialId)changed.push({id:walker.id,uuid:walker.uuid,
        position:{...walker.position},state:walker.state,status:walker.experienceStatus,currentFloor:walker.currentFloor,currentRoom:walker.currentRoom,
        currentBlock:walker.currentBlock,currentArea:walker.currentArea,facing:walker.facing||null,visualVisit:walker.visualVisit||null,socialInteraction});
      socialStatesSent.set(walker.id,socialId);
    }
    if(significant.length)try{store.save(significant,now());for(const w of significant)operations?.notify(w.uuid);}catch{log('database:error',{code:'SPATIAL_CHECKPOINT_ERROR'});}
    if(changed.length&&io.sockets.adapter.rooms.get('live')?.size)io.to('live').emit('participants:moved',{participants:changed});
    if(time-lastOperatorUpdate>=500){
      operatorControl.refresh();lastOperatorUpdate=time;
      if(io.sockets.adapter.rooms.get('debug-world')?.size)io.to('debug-world').emit('world:visits',visitController.snapshot(walkers));
    }
    if(time-lastSave>=5000) {checkpoint();lastSave=time;}
  },100);timer.unref();

  function approveEntry(uuid){
    if(resettingParticipants||closed)throw Object.assign(new Error('Aguarde a limpeza ou reinicialização.'),{status:409});
    const p=store.approveAvatar(uuid,now(),experience.entryDelayMs,experience.entrySpacingMs);
    if(!p)throw Object.assign(new Error('Aguarde a preparação do seu crachá.'),{status:409});
    entryScheduler.schedule(p);
    try{passService.request(p.uuid);passService.entryApproved(p.uuid);}catch{log('portrait:failed',{ref:p.uuid.slice(0,8),code:'PORTRAIT_SCHEDULE_FAILED'});}
    operationEvents.changed(uuid);return p;
  }
  function removeParticipant(uuid){
    if(!store.removeFromWorld(uuid,now()))throw Object.assign(new Error('Participante já saiu ou não está no mundo.'),{status:409});
    const walker=walkers.get(uuid);if(walker)visitController.release(walker);
    entryScheduler.cancel(uuid);avatarPipeline.cancel(uuid);passService.settleInactive(uuid);
    walkers.delete(uuid);displayed.delete(uuid);socialStatesSent.delete(uuid);
    if(operatorControl.state().focusedParticipantUuid===uuid)operatorControl.goHome();else operatorControl.refresh();
    io.to('live').emit('participant:removed',{uuid,id:uuid});
    selfieLifecycle.request(uuid).catch(()=>{});operationEvents.changed(uuid);
  }
  operations=attachAdminOperations({app,io,auth,store,walkers,avatarPipeline,passService,selfieLifecycle,entryScheduler,operatorControl,
    events:operationEvents,dataDir,now,personalization,approveEntry,removeParticipant,logger:log,isUnavailable:()=>closed||resettingParticipants,
    configuration:()=>{const cf=portraitConfig();return {provider,openrouter:!!openRouterConfig().apiKey,cloudflare:!!cf.token&&/^[a-f0-9]{32}$/i.test(cf.accountId)};}});

  app.get('/',(_req,res)=>res.redirect('/tela'));
  app.get(['/world','/tela','/tela.html'],(_req,res)=>res.sendFile(path.join(__dirname,'public/tela.html')));
  app.get(['/operator','/operator.html'],(_req,res)=>res.sendFile(path.join(__dirname,'public/operator.html')));
  app.get(['/checkin','/check-in','/check-in.html'],(_req,res)=>res.sendFile(path.join(__dirname,'public/check-in.html')));
  app.get('/vendor/phaser.js',(_req,res)=>res.sendFile(require.resolve('phaser/dist/phaser.min.js')));
  let selfiePrivacyPolicyUrl=options.selfiePrivacyPolicyUrl||process.env.SELFIE_PRIVACY_POLICY_URL||null;
  if(selfiePrivacyPolicyUrl&&!(/^\/(?!\/)/.test(selfiePrivacyPolicyUrl)||/^https:\/\/[^\s]+$/i.test(selfiePrivacyPolicyUrl)))selfiePrivacyPolicyUrl=null;
  app.get('/api/config',(_req,res)=>res.set('Cache-Control','no-store').json({selfieNoticeVersion:SELFIE_NOTICE_VERSION,selfiePrivacyPolicyUrl,maxSelfieBytes:MAX_SELFIE_BYTES}));
  app.get('/api/operation/config',(req,res)=>{res.set('Cache-Control','no-store');res.json({avatarProvider:provider,selfieNoticeVersion:SELFIE_NOTICE_VERSION,selfiePrivacyPolicyUrl,
    provisional:!personalization,maxSelfieBytes:MAX_SELFIE_BYTES,cycle:store.cycle(now()),canResetParticipants:canResetParticipants(req)});});
  const reviewParticipant=p=>({...publicParticipant(p),selfieStatus:p.selfieStatus,selfieDeletedAt:p.selfieDeletedAt,avatarVersions:p.avatarVersions,maxAvatarVersions:experience.maxAvatarVersions,
    approvedAt:p.approvedAt,scheduledEntryAt:p.scheduledEntryAt,enteredAt:p.enteredAt,
    passUrl:p.passNumber?`/pass/${p.uuid}`:null});
  const sessionResponse=p=>({participant:reviewParticipant(p),reviewToken:p.reviewToken});
  function authorizeReview(req,res,next){
    const p=store.findByUuid(req.params.uuid),token=req.get('Authorization')?.replace(/^Bearer /,'');
    if(!p){res.status(404).json({error:'Cadastro não encontrado.'});return;}
    if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)||!p.reviewToken||token.length!==p.reviewToken.length||!timingSafeEqual(Buffer.from(token),Buffer.from(p.reviewToken))){res.status(403).json({error:'Sessão de cadastro inválida.'});return;}
    if(p.status==='INACTIVE'){res.status(409).json({error:'Este cadastro está inativo.'});return;}
    req.participant=p;next();
  }
  app.get('/api/participants/:uuid/avatar-status',authorizeReview,(req,res)=>{res.set('Cache-Control','no-store');res.json({participant:reviewParticipant(req.participant)});});
  attachPassRoutes({app,store,passService,authorizeReview,auth});
  app.post('/api/participants/:uuid/approve-avatar',authorizeReview,(req,res)=>{
    if(resettingParticipants||closed){res.status(409).json({error:'Aguarde a limpeza ou reinicialização.'});return;}
    // The portrait wait is presentation-only; a prepared LPC can enter even if the portrait service is slow.
    const p=approveEntry(req.params.uuid);
    res.json({participant:reviewParticipant(store.findByUuid(p.uuid))});
  });
  app.post('/api/participants/:uuid/regenerate-avatar',authorizeReview,(req,res)=>{
    if(resettingParticipants||closed||!store.startRegeneration(req.params.uuid,experience.maxAvatarVersions)){
      res.status(409).json({error:'Não é possível criar outra versão: aguarde a prévia ou o limite foi atingido.'});return;
    }
    avatarPipeline.enqueue(req.params.uuid);res.json({participant:reviewParticipant(store.findByUuid(req.params.uuid))});
  });
  app.delete('/api/participants',(req,res,next)=>{
    if(!canResetParticipants(req)){res.status(403).json({error:'Acesso administrativo necessário.'});return;}
    if(req.get('X-SENAI-ADMIN')!=='reset-participants'){res.status(403).json({error:'Solicitação de limpeza inválida.'});return;}
    const origin=req.get('Origin');
    if(origin){try{if(new URL(origin).host!==req.get('Host'))throw new Error();}catch{res.status(403).json({error:'Origem da solicitação inválida.'});return;}}
    if(closed||resettingParticipants||processing||pending.size){res.status(409).json({error:'Aguarde o check-in ou a limpeza em andamento e tente novamente.'});return;}
    resettingParticipants=true;
    resetTask=(async()=>{
      entryScheduler.clear();
      await avatarPipeline.reset();
      await passService.reset();
      const ids=new Set(store.list().map(p=>p.id));
      const deleted=store.clearParticipants();visitController.clear();walkers.clear();displayed.clear();socialStatesSent.clear();
      operatorControl.refresh();
      io.to('live').emit('participants:cleared');
      let cleanupFailures=0;
      for(const directory of [avatarDir,photoDir]){
        const files=await fs.readdir(directory,{withFileTypes:true});
        for(const file of files){
          const match=/^([0-9a-f-]{36})(?:-[0-9a-f]{16})?\.png$/.exec(file.name);
          if(file.isFile()&&match&&ids.has(match[1]))await fs.unlink(path.join(directory,file.name))
            .catch(()=>{cleanupFailures++;});
        }
      }
      const generatedRoot=path.resolve(dataDir,'generated/participants');
      for(const id of ids)if(/^[0-9a-f-]{36}$/i.test(id)){
        const target=path.resolve(generatedRoot,id);
        if(target.startsWith(generatedRoot+path.sep))await fs.rm(target,{recursive:true,force:true}).catch(()=>{cleanupFailures++;});
      }
      operationEvents.clearParticipantErrors();log('participants:cleared',{count:deleted,cleanupFailures});
      return {deleted,cleanupFailures};
    })();
    resetTask.then(result=>res.json(result)).catch(next).finally(()=>{resettingParticipants=false;resetTask=null;});
  });
  app.get('/api/participants',(_req,res)=>{res.set('Cache-Control','no-store');res.json(snapshot());});
  app.get('/api/world',(req,res)=>{res.set('Cache-Control','no-store');res.json({...snapshot(),
    ...(req.query.debugWorld==='true'?{debugWorldEnabled:process.env.NODE_ENV!=='production'}:{}),
    ...(req.query.debugWorld==='true'&&process.env.NODE_ENV!=='production'?{visits:visitController.snapshot(walkers)}:{})});});
  app.get('/health',(_req,res)=>res.set('Cache-Control','no-store').status(closed?503:200).json({ok:!closed}));
  app.get('/api/health',(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json({status:'ok',database:'connected',activeParticipants:store.health().active});}
    catch(error){log('database:error',{code:error.code||'DATABASE_ERROR'});res.status(503).json({status:'error',database:'unavailable'});}
  });
  app.get('/api/participants/:uuid',(req,res)=>{
    res.set('Cache-Control','no-store');const data=store.findByUuid(req.params.uuid);
    if(!data||!['ACTIVE','ENTERING'].includes(data.experienceStatus)){res.status(404).json({error:'Participante não encontrado.'});return;}
    res.json({participant:publicParticipant({...data,...walkers.get(data.id),status:data.status,
      facing:walkers.get(data.id)?.facing||null,visualVisit:walkers.get(data.id)?.visualVisit||null,
      socialInteraction:walkers.get(data.id)?.socialInteraction||null})});
  });
  app.get('/api/participants/:id/status',(req,res)=>{
    const walker=walkers.get(req.params.id);
    if(!walker){res.status(404).json({error:'Participante não encontrado.'});return;}
    res.set('Cache-Control','no-store');
    res.json({ready:true,displayed:(displayed.get(walker.id)||0)>now()-30000,entered:walker.state!=='ENTERING'});
  });
  app.get('/avatars/:filename',(req,res)=>{
    if(!/^[0-9a-f-]{36}(?:-[0-9a-f]{16})?\.png$/.test(req.params.filename)){res.sendStatus(404);return;}
    res.set('Link','</assets/avatars/lpc/CREDITS-LPC.md>; rel="license"');
    res.sendFile(req.params.filename,{root:avatarDir});
  });

  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_SELFIE_BYTES,files:1,fields:3,fieldSize:1024,parts:4}}).single('selfie');
  let processing=0;
  const capacity=(req,res,next)=>{
    if(closed||resettingParticipants){res.status(503).json({error:'O servidor está reiniciando ou limpando os cadastros. Tente novamente em instantes.'});return;}
    if(processing>=16){res.status(429).json({error:'Muitas pessoas estão entrando. Tente novamente em alguns instantes.'});return;}
    processing++;let released=false;
    const release=()=>{if(!released){released=true;processing--;}};
    res.once('finish',release);res.once('close',release);next();
  };
  app.post('/api/check-in',capacity,upload,async(req,res,next)=>{
    let selfie;
    try {
      if(req.body?.selfieAiAcknowledged!=='true')throw Object.assign(new Error('Confirme que está ciente do processamento da selfie por serviços de inteligência artificial.'),{status:400});
      const identity=validateIdentity(req.body);
      selfie=await validateSelfie(req.file);
      const existing=store.findByEmail(identity.email);
      if(existing){
        log('avatar:existing-reused',{ref:existing.uuid.slice(0,8),avatarStatus:existing.avatarStatus});
        if(existing.status==='INACTIVE')throw Object.assign(new Error('Este cadastro está inativo. Não foi criado outro participante.'),{status:409});
        res.json({...sessionResponse({...existing,...walkers.get(existing.id)}),duplicate:true});return;
      }
      if(pending.has(identity.email)) {
        const session=await pending.get(identity.email);
        res.json({...session,duplicate:true});return;
      }
      if(pending.size>=16) throw Object.assign(new Error('O mundo está recebendo outros avatares. Tente novamente em instantes.'),{status:429});
      const id=randomUUID();
      const task=(async()=>{
        const result=await generate({id,name:identity.name,selfie});
        const sharp=require('sharp');
        // Canonical PNG, without metadata; only generated avatars are publicly served.
        const source=sharp(result.buffer,{limitInputPixels:20000000});
        const image=await (result.kind==='lpc'?source:source.resize(64,96,{fit:'contain',background:{r:0,g:0,b:0,alpha:0},kernel:'nearest'})).png().toBuffer();
        const filename=`${id}.png`,filePath=path.join(avatarDir,filename);
        const photoFilename=`${id}.png`,photoPath=path.join(photoDir,photoFilename);
        let avatarWritten=false,photoWritten=false;
        try {
          await fs.writeFile(filePath,image,{flag:'wx'});avatarWritten=true;
          // Persist a normalized, metadata-free photo privately; never publish selfies to the TV.
          await fs.writeFile(photoPath,selfie,{flag:'wx'});photoWritten=true;
          const walker=createWalker({id,name:identity.name,avatar:`/avatars/${filename}`,avatarKind:result.kind,
            photoPath:`photos/${photoFilename}`,selfieAiAcknowledgedAt:new Date(now()).toISOString(),selfieNoticeVersion:SELFIE_NOTICE_VERSION,
            avatarType:result.kind==='lpc'?'lpc':'placeholder',
            avatarStatus:personalization&&result.kind==='lpc'?'PENDING':'FALLBACK',
            appearance:result.kind==='lpc'?DEFAULT_AVATAR:null,avatarVersion:result.kind==='lpc'?'provisional':null,
            experienceStatus:personalization&&result.kind==='lpc'?'AVATAR_PROCESSING':'AVATAR_REVIEW'},store.list().length);
          // Assign the cycle AFTER generation, using the server clock at completion.
          try{store.insert(walker,identity.email,now());}
          catch(error){log('database:error',{code:error.code||'DATABASE_ERROR'});throw error;}
          log('participant:registered',{ref:id.slice(0,8)});
          try{passService.request(id);}catch{log('portrait:failed',{ref:id.slice(0,8),code:'PORTRAIT_SCHEDULE_FAILED'});}
          if(walker.avatarStatus!=='PENDING')selfieLifecycle.finish(id,'avatar');
          const session=sessionResponse(store.findByUuid(id));
          if(walker.avatarStatus==='PENDING')setImmediate(()=>{if(!closed)avatarPipeline.enqueue(id);});
          return session;
        } catch(error){
          if(avatarWritten)await fs.unlink(filePath).catch(()=>{});
          if(photoWritten)await fs.unlink(photoPath).catch(()=>{});
          throw error;
        }
      })();
      pending.set(identity.email,task);
      try {res.status(201).json({...await task,duplicate:false});}
      finally {pending.delete(identity.email);}
    } catch(error) {
      if(!error.status) error=Object.assign(new Error('Não conseguimos gerar seu avatar. Tente enviar a foto novamente.'),{status:502});
      next(error);
    } finally {
      // Persisted normalized photo is private; clear request buffers after processing.
      req.file?.buffer?.fill(0);selfie?.fill(0);
    }
  });
  app.use(express.static(path.join(__dirname,'public')));
  app.get('/favicon.ico',(_req,res)=>res.status(204).end());
  app.use((error,req,res,_next)=>{
    req.file?.buffer?.fill(0);
    const isUpload=error instanceof multer.MulterError;
    const status=isUpload?(error.code==='LIMIT_FILE_SIZE'?413:400):(error.status||500);
    log(isUpload||status===400||status===413?'upload:error':'request:error',{status,code:error.code||'REQUEST_FAILED'});
    const message=isUpload?(error.code==='LIMIT_FILE_SIZE'?'A selfie deve ter até 5 MB.':'Envie nome, e-mail, confirmação de ciência e uma selfie.'):
      error.type==='entity.parse.failed'?'Solicitação JSON inválida.':status>=500?'Não foi possível concluir a solicitação.':(error.status?error.message:'Não foi possível concluir a solicitação.');
    res.status(status).json({error:message});
  });
  await selfieLifecycle.sweep();selfieLifecycle.start();
  return {app,server,io,store,walkers,avatarPipeline,entryScheduler,passService,operatorControl,visitController,selfieLifecycle,auth,operations,
    async close(){
      if(closed)return;closed=true;operations.close();clearInterval(timer);entryScheduler.close();visitController.clear();
      await Promise.allSettled([...pending.values(),...(resetTask?[resetTask]:[])]);await avatarPipeline.close();await passService.close();await selfieLifecycle.close();const saved=checkpoint();
      await new Promise(resolve=>io.close(resolve));
      if(server.listening) await new Promise(resolve=>server.close(resolve));
      auth.close();store.close();if(!saved)throw new Error('Falha ao salvar o último checkpoint; os cadastros anteriores permanecem no banco.');
    },
  };
}

if(require.main===module) {
  // Node's built-in .env support keeps credentials server-side without another dependency.
  try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT') throw error;}
  createApplication().then(runtime=>{
    const port=process.env.PORT||3000;
    runtime.server.listen(port,'0.0.0.0',()=>console.log(`Mundo // Digital: http://localhost:${port}/tela | check-in: /check-in | IA: ${process.env.AVATAR_PROVIDER||'local (provisório)'}`));
    runtime.server.on('error',async error=>{console.error('Não foi possível iniciar o servidor:',error.message);await runtime.close();process.exitCode=1;});
    let shuttingDown=false;
    const shutdown=async()=>{if(shuttingDown)return;shuttingDown=true;
      try{await runtime.close();process.exit(0);}catch{console.error('Falha no encerramento do servidor. Verifique os logs operacionais.');process.exit(1);}};
    process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  }).catch(error=>{console.error('Não foi possível iniciar:',error.message);process.exitCode=1;});
}
module.exports={createApplication,publicParticipant,validateIdentity};
