const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomBytes,createHash}=require('node:crypto'),sharp=require('sharp');
const {io}=require('socket.io-client');
const {createApplication}=require('../server');
const {DEFAULT_AVATAR}=require('../lib/avatarCatalog');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await pause(100);}throw Error('Production smoke timed out');}
async function temp(){await fs.mkdir('.test-data',{recursive:true});return fs.mkdtemp(path.resolve('.test-data/production-readiness-'));}
function production(t){const keys=['NODE_ENV','DATA_DIR','APP_ORIGIN','TRUST_PROXY','SESSION_SECRET','EVENT_EDITION','EVENT_HASHTAG','EVENT_INSTAGRAM_HANDLE','PASS_DEFAULT_ROLE','PASS_DEFAULT_ORGANIZATION','PASS_PORTRAIT_WAIT_MS'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.NODE_ENV='production';process.env.DATA_DIR='';process.env.APP_ORIGIN='https://world.example';process.env.TRUST_PROXY='loopback';process.env.SESSION_SECRET=randomBytes(48).toString('hex');
 Object.assign(process.env,{EVENT_EDITION:'2026',EVENT_HASHTAG:'#MundoDigital',EVENT_INSTAGRAM_HANDLE:'',PASS_DEFAULT_ROLE:'',PASS_DEFAULT_ORGANIZATION:'',PASS_PORTRAIT_WAIT_MS:'15000'});
 t.after(()=>{for(const [key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;});}
const proxyHeaders={'X-Forwarded-Proto':'https',Origin:'https://world.example'};
class Admin{
 constructor(base){this.base=base;this.cookie='';}
 async request(route,{method='GET',body,headers={}}={}){const r=await fetch(this.base+route,{method,redirect:'manual',headers:{...proxyHeaders,...(this.cookie?{Cookie:this.cookie}:{}),...(this.csrf?{'X-CSRF-Token':this.csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const cookies=r.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(v=>v.split(';')[0]).join('; ');return r;}
 async login(username,password){this.csrf=(await(await this.request('/api/auth/session')).json()).csrfToken;const r=await this.request('/login',{method:'POST',body:{username,password}});this.csrf=(await r.json()).csrfToken;return r;}
}

test('production requires explicit private DATA_DIR and rejects public storage including symlink targets',async t=>{
 production(t);await assert.rejects(createApplication({avatarProvider:'local'}),/DATA_DIR/);
 const publicPath=await fs.mkdtemp(path.resolve('public/.readiness-')),directory=await temp(),link=path.join(directory,'public-link');
 try{await assert.rejects(createApplication({dataDir:publicPath,avatarProvider:'local'}),/diretório público/);
  await fs.symlink(path.resolve('public'),link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(createApplication({dataDir:link,avatarProvider:'local'}),/diretório público/);
 }finally{await fs.rmdir(publicPath);if(process.platform==='win32')await fs.rmdir(link).catch(()=>{});else await fs.unlink(link).catch(()=>{});}
});

test('production smoke: proxy Secure session, public check-in, both pipelines, real Story, entry, sockets/tracking and restart with persistent assets/session',async t=>{
 production(t);const dataDir=await temp();let runtime,child;const sockets=[];
 const secret=process.env.SESSION_SECRET,password=randomBytes(24).toString('hex');let analysisCalls=0,portraitCalls=0;
 const png=await sharp({create:{width:512,height:512,channels:3,background:'#a8c3b4'}}).png().toBuffer();
 try{
  runtime=await createApplication({dataDir,avatarProvider:'openrouter',entryDelayMs:0,entrySpacingMs:0,logger:()=>{},
   analyzeSelfie:async(_filename,{signal})=>{assert.equal(signal.aborted,false);analysisCalls++;return DEFAULT_AVATAR;},generatePortrait:async()=>{portraitCalls++;return png;}});
  runtime.server.listen(0,'0.0.0.0');await new Promise(resolve=>runtime.server.once('listening',resolve));const base=`http://127.0.0.1:${runtime.server.address().port}`;
  for(const directory of ['avatars','photos'])assert.ok((await fs.stat(path.join(dataDir,directory))).isDirectory());
  for(const file of ['participants.sqlite','auth.sqlite'])assert.ok((await fs.stat(path.join(dataDir,file))).isFile());
  assert.equal(runtime.store.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.deepEqual(await(await fetch(base+'/health')).json(),{ok:true});assert.equal((await fetch(base+'/checkin')).status,200);
  for(const route of ['/world','/admin'])assert.equal((await fetch(base+route,{redirect:'manual'})).status,302);
  for(const route of ['/api/world','/api/admin/operations','/api/participants/search?q=Smoke','/api/health'])assert.equal((await fetch(base+route)).status,401);
  await runtime.auth.store.create('production-smoke',password);const admin=new Admin(base);const login=await admin.login('production-smoke',password);assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/__Host-world_session=.*HttpOnly; Secure; SameSite=Lax/);
  for(const route of ['/world','/admin','/api/admin/operations'])assert.equal((await admin.request(route)).status,200);
  assert.equal((await admin.request('/api/world')).headers.get('access-control-allow-origin'),null);
  const malformed=await fetch(base+'/api/admin/users',{method:'POST',headers:{...proxyHeaders,Cookie:admin.cookie,'X-CSRF-Token':admin.csrf,'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:'Solicitação JSON inválida.'});
  const body=new FormData();body.set('name','Visitante Smoke');body.set('email','production-smoke@example.test');body.set('selfieAiAcknowledged','true');body.set('selfie',new Blob([png],{type:'image/png'}),'synthetic.png');
  const checkin=await fetch(base+'/api/check-in',{method:'POST',body});assert.equal(checkin.status,201);const session=await checkin.json(),uuid=session.participant.uuid;
  await runtime.avatarPipeline.idle();await runtime.passService.idle();await runtime.selfieLifecycle.idle();
  const stored=runtime.store.findByUuid(uuid);assert.equal(stored.avatarStatus,'READY');assert.equal(stored.portraitStatus,'READY');assert.equal(stored.selfieStatus,'DELETED');assert.equal(stored.photoPath,null);
  assert.equal(analysisCalls,1);assert.equal(portraitCalls,1);
  assert.equal((await fetch(base+'/api/participants/'+uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+session.reviewToken}})).status,200);
  await runtime.passService.idle();assert.equal(runtime.store.findByUuid(uuid).storyStatus,'READY');
  await until(()=>runtime.store.findByUuid(uuid).experienceStatus==='ACTIVE');
  const pass=await(await fetch(base+'/api/pass/'+uuid)).json();for(const sensitive of ['production-smoke@example.test','photoPath','photos/','reviewToken','SESSION_SECRET'])assert.ok(!JSON.stringify(pass).includes(sensitive));
  const paths=[stored.avatar,pass.pass.portraitUrl,pass.pass.storyUrl],hashes=[];
  for(const route of paths){const r=await fetch(base+route);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());hashes.push(createHash('sha256').update(bytes).digest('hex'));if(route===pass.pass.storyUrl){const m=await sharp(bytes).metadata();assert.equal(m.width,1080);assert.equal(m.height,1920);}}
  for(const route of ['/.env','/data/participants.sqlite','/auth.sqlite','/photos/'+uuid+'.png'])assert.notEqual((await admin.request(route)).status,200);
  const connect=async mode=>{const s=io(base,{autoConnect:false,auth:{mode},extraHeaders:{...proxyHeaders,Cookie:admin.cookie},transports:['websocket'],reconnection:false});sockets.push(s);await new Promise((yes,no)=>{s.once('connect',yes);s.once('connect_error',no);s.connect();});return s;};
  await connect('live');const operator=await connect('operator');assert.equal((await(await admin.request('/api/admin/operations')).json()).system.tv.status,'ONLINE');
  const focus=await new Promise((yes,no)=>operator.timeout(2000).emit('camera:focusParticipant',{participantUuid:uuid},(e,value)=>e?no(e):yes(value)));assert.equal(focus.ok,true);assert.equal(runtime.operatorControl.state().focusedParticipantUuid,uuid);
  const debug=await(await admin.request('/api/world?debugWorld=true')).json();assert.equal(debug.debugWorldEnabled,false);assert.equal(debug.visits,undefined);
  for(const socket of sockets)socket.close();await runtime.close();runtime=null;
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  // Windows kill(SIGTERM) terminates forcibly. IPC emits the same Node signal handlers
  // so the real entrypoint's graceful shutdown can be exercised on every platform.
  const preload=path.join(dataDir,'signal-fixture.cjs');await fs.writeFile(preload,"process.once('message',()=>{process.emit('SIGTERM');process.emit('SIGINT');});");
  child=spawn(process.execPath,['--use-system-ca','--require',preload,path.resolve('server.js')],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,SESSION_SECRET:secret,AVATAR_PROVIDER:'local',OPENROUTER_API_KEY:'',GEMINI_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const next=`http://127.0.0.1:${port}`;await until(async()=>{if(child.exitCode!==null)throw Error('Production entrypoint exited before health: '+child.exitCode);try{return(await fetch(next+'/health')).ok;}catch{return false;}});
  const restored=new Admin(next);restored.cookie=admin.cookie;restored.csrf=admin.csrf;assert.equal((await restored.request('/api/admin/operations')).status,200,'persisted session survives restart');
  const world=await(await restored.request('/api/world')).json();assert.equal(world.participants.length,1);assert.equal(world.participants[0].uuid,uuid);
  for(let i=0;i<paths.length;i++){const r=await fetch(next+paths[i]);assert.equal(r.status,200,paths[i]);assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),hashes[i]);}
  const detail=await(await restored.request('/api/admin/participants/'+uuid)).json();assert.equal(detail.participant.selfieStatus,'DELETED');assert.equal((await fs.readdir(path.join(dataDir,'photos'))).length,0);
  child.send('shutdown');let timeout;try{const exit=await Promise.race([exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Graceful shutdown timed out')),10000);})]);assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.ok(!output.includes('Falha no encerramento'));}finally{clearTimeout(timeout);}
 }finally{for(const s of sockets)s.close();await runtime?.close();if(child&&child.exitCode===null)child.kill();}
});
