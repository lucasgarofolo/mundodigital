const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{randomBytes}=require('node:crypto'),sharp=require('sharp');
const {createApplication}=require('../server');
const {io:connect}=require('socket.io-client');
const secret=randomBytes(48).toString('hex'),password='Uma frase de teste segura 123';
async function start(options={}){await fs.mkdir('.test-data',{recursive:true});const dataDir=options.dataDir||await fs.mkdtemp(path.resolve('.test-data/auth-'));
 const r=await createApplication({dataDir,avatarProvider:'local',entryDelayMs:0,entrySpacingMs:0,logger:()=>{},storyRenderer:require('./helpers/storyRenderer'),...options,authConfig:{secret,...options.authConfig}});
 r.server.listen(0);await new Promise(yes=>r.server.once('listening',yes));return {...r,dataDir,base:`http://localhost:${r.server.address().port}`};}
class Client{
 constructor(base,extra={}){this.base=base;this.extra=extra;this.cookie='';}
 async request(url,{method='GET',body,csrf=true,headers={},...rest}={}){const r=await fetch(this.base+url,{method,redirect:'manual',headers:{...this.extra,...(this.cookie?{Cookie:this.cookie}:{}),...(csrf&&this.token?{'X-CSRF-Token':this.token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),...rest});
  const values=r.headers.getSetCookie();if(values.length)this.cookie=values.map(v=>v.split(';')[0]).join('; ');return r;}
 async session(){const r=await this.request('/api/auth/session');const data=await r.json();this.token=data.csrfToken;return data;}
 async login(username='admin-test',value=password){await this.session();const r=await this.request('/login',{method:'POST',body:{username,password:value}});const data=await r.json();if(data.csrfToken)this.token=data.csrfToken;return {r,data};}
}
test('all operational HTML aliases/APIs are private, health/config minimal, participant check-in/pass/entry remain public',async()=>{
 const r=await start({generatePortrait:async()=>sharp({create:{width:512,height:512,channels:3,background:'#aacccc'}}).png().toBuffer()});
 try{
  for(const url of ['/world','/tela','/tela.html','/operator','/operator.html','/admin','/admin.html','/world?debugWorld=true']){const response=await fetch(r.base+url,{redirect:'manual'});assert.equal(response.status,302,url);assert.match(response.headers.get('location'),/^\/login\?next=/);}
  for(const [method,url]of [['GET','/api/world'],['GET','/api/participants'],['GET','/api/participants/search?q=teste'],['GET','/api/participants/no-id'],['GET','/api/participants/no-id/status'],['GET','/api/operator/session'],['GET','/api/operator/camera'],['GET','/api/admin/users'],['GET','/api/health'],['GET','/api/operation/config'],['POST','/api/admin/users'],['DELETE','/api/participants'],['POST','/api/participants/no-id/regenerate-avatar'],['POST','/api/participants/no-id/retry-portrait']]){
   const response=await fetch(r.base+url,{method});assert.equal(response.status,401,method+' '+url);assert.match(response.headers.get('content-type'),/json/);}
  assert.deepEqual(await(await fetch(r.base+'/health')).json(),{ok:true});const config=await(await fetch(r.base+'/api/config')).json();
  assert.deepEqual(Object.keys(config).sort(),['maxSelfieBytes','selfieNoticeVersion','selfiePrivacyPolicyUrl'].sort());
  for(const url of ['/checkin','/check-in','/check-in.html'])assert.equal((await fetch(r.base+url)).status,200);
  const body=new FormData();body.set('name','Visitante Público');body.set('email','public-auth@example.test');body.set('selfieAiAcknowledged','true');
  body.set('selfie',new Blob([await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer()],{type:'image/png'}),'synthetic.png');
  const checkin=await fetch(r.base+'/api/check-in',{method:'POST',body});assert.equal(checkin.status,201);const s=await checkin.json(),id=s.participant.uuid;
  await r.avatarPipeline.idle();await r.passService.idle();assert.equal((await fetch(r.base+'/pass/'+id)).status,200);
  const pass=await(await fetch(r.base+'/api/pass/'+id)).json();assert.equal(pass.pass.canRetryPortrait,false);assert.ok(!JSON.stringify(pass).includes('reviewToken'));
  const headers={Authorization:'Bearer '+s.reviewToken};assert.equal((await fetch(r.base+'/api/participants/'+id+'/avatar-status',{headers})).status,200);
  assert.equal((await fetch(r.base+'/api/participants/'+id+'/approve-avatar',{method:'POST',headers})).status,200);
  assert.equal((await fetch(r.base+'/api/participants/'+id+'/regenerate-avatar',{method:'POST',headers})).status,401);
  assert.equal((await fetch(r.base+'/api/participants/'+id+'/retry-portrait',{method:'POST',headers})).status,401);
  await r.passService.idle();const shared=await(await fetch(r.base+'/api/pass/'+id)).json();assert.equal((await fetch(r.base+shared.pass.storyUrl)).status,200);
  for(const url of ['/.env','/data/auth.sqlite','/lib/authStore.js','/photos/private.png','/assets/avatars/lpc/%2e%2e%2f%2e%2e%2f%2e%2e%2ftela.html','/assets/avatars/lpc/%2e%2e%5c..%5c..%5ctela.html'])assert.notEqual((await fetch(r.base+url,{redirect:'manual'})).status,200,url);
 }finally{await r.close();}
});
test('Argon2id, generic failure, session rotation/restart/logout, CSRF, Origin and safe redirect',async()=>{
 let r=await start();try{
  const user=await r.auth.store.create('admin-test',password);const hash=r.auth.store.get(user.id).password_hash;assert.match(hash,/^\$argon2id\$/);assert.ok(!JSON.stringify(r.auth.store.list()).includes(hash));
  const client=new Client(r.base);await client.session();const before=client.cookie;
  const missing=await client.login('missing'),wrong=await client.login('admin-test','wrong');assert.equal(missing.r.status,401);assert.deepEqual(missing.data,wrong.data);assert.equal(wrong.data.error,'Usuário ou senha inválidos.');
  const login=await client.login();assert.equal(login.r.status,200);assert.notEqual(before,client.cookie);assert.match(login.r.headers.get('set-cookie'),/HttpOnly/);assert.match(login.r.headers.get('set-cookie'),/SameSite=Lax/);
  assert.deepEqual(Object.keys(login.data.user).sort(),['id','username','role'].sort());assert.equal((await client.request('/world')).status,200);
  assert.equal((await client.request('/api/admin/users',{method:'POST',csrf:false,body:{}})).status,403);
  assert.equal((await client.request('/api/admin/users',{method:'POST',body:{},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await client.request('/api/admin/users',{method:'POST',body:{},headers:{'X-CSRF-Token':'é'.repeat(43)}})).status,403);
  const dataDir=r.dataDir;await r.close();r=await start({dataDir});client.base=r.base;assert.equal((await client.request('/api/admin/users')).status,200);
  const sessionRows=r.auth.store.db.prepare('SELECT sess FROM admin_sessions WHERE user_id=?').all(user.id);assert.equal(sessionRows.length,1);assert.ok(!JSON.stringify(sessionRows).includes('password_hash'));
  const redirect=await client.request('/logout',{method:'POST'});assert.equal(redirect.status,303);assert.match(redirect.headers.get('set-cookie'),/world_session=;/);assert.equal((await client.request('/api/world')).status,401);
  const again=await client.login();assert.equal(again.r.status,200);const badReturn=await client.request('/login',{method:'POST',body:{username:'admin-test',password,next:'//evil.example'}});assert.equal((await badReturn.json()).next,'/world');
 }finally{await r.close();}
});
test('admin management protects last account, rejects public registration and revokes sessions on disable/reset/self-password change',async()=>{
 const logs=[],r=await start({logger:(event,details)=>logs.push({event,details})});try{const first=await r.auth.store.create('admin-test',password),a=new Client(r.base);await a.login();
  assert.equal((await a.request(`/api/admin/users/${first.id}/disable`,{method:'POST'})).status,409);
  assert.equal((await a.request('/api/admin/users',{method:'POST',body:{username:'other-admin',password:'short',confirmPassword:'short'}})).status,400);
  const created=await a.request('/api/admin/users',{method:'POST',body:{username:'other-admin',password,confirmPassword:password}});assert.equal(created.status,201);const other=(await created.json()).user;
  const b=new Client(r.base);assert.equal((await b.login('other-admin')).r.status,200);
  assert.equal((await a.request(`/api/admin/users/${other.id}/password`,{method:'POST',body:{password:password+' new',confirmPassword:password+' new'}})).status,200);
  assert.equal((await b.request('/api/world')).status,401);assert.equal((await b.login('other-admin',password+' new')).r.status,200);
  assert.equal((await a.request(`/api/admin/users/${other.id}/disable`,{method:'POST'})).status,200);assert.equal((await b.request('/api/world')).status,401);assert.equal((await b.login('other-admin',password+' new')).r.status,401);
  assert.equal((await a.request('/api/admin/password',{method:'POST',body:{currentPassword:'wrong',password:password+' own',confirmPassword:password+' own'}})).status,400);
  assert.equal((await a.request('/api/admin/password',{method:'POST',body:{currentPassword:password,password:password+' own',confirmPassword:password+' own'}})).status,200);
  assert.equal((await a.request('/api/world')).status,401);assert.equal((await a.login('admin-test',password+' own')).r.status,200);
  for(const event of ['login-success','login-failure','admin-created','admin-disabled','password-reset','password-changed'])assert.ok(logs.some(row=>row.event==='security:'+event),event);
  assert.ok(!JSON.stringify(logs).includes(password));assert.ok(!JSON.stringify(logs).includes('$argon2id$'));
 }finally{await r.close();}
});

test('startup fails closed without a session secret or without the production HTTPS origin',async()=>{
 await fs.mkdir('.test-data',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('.test-data/auth-config-'));
 await assert.rejects(createApplication({dataDir,avatarProvider:'local',logger:()=>{},authConfig:{secret:''}}),/SESSION_SECRET/);
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{
  await assert.rejects(createApplication({dataDir,avatarProvider:'local',logger:()=>{},authConfig:{secret,origin:''}}),/APP_ORIGIN/);
 }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('login rate limit expires and an authenticated session expires server-side',async()=>{
 const r=await start({authConfig:{loginLimit:2,loginWindowMs:1000,maxAgeHours:0.0001}});try{await r.auth.store.create('admin-test',password);const c=new Client(r.base);
  await c.login('missing','bad');await c.login('missing','bad');assert.equal((await c.login()).r.status,429);await new Promise(yes=>setTimeout(yes,1100));assert.equal((await c.login()).r.status,200);
  assert.equal((await c.request('/api/world')).status,200);await new Promise(yes=>setTimeout(yes,400));assert.equal((await c.request('/api/world')).status,401);
 }finally{await r.close();}
});
test('production requires secret/origin and emits Secure cookie behind explicitly trusted HTTPS proxy',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';let r;try{
  r=await start({authConfig:{origin:'https://world.example',trustProxy:'loopback'}});await r.auth.store.create('admin-test',password);
  const c=new Client(r.base,{'X-Forwarded-Proto':'https',Origin:'https://world.example'}),login=await c.login();assert.equal(login.r.status,200);assert.match(login.r.headers.get('set-cookie'),/Secure/);assert.match(login.r.headers.get('set-cookie'),/__Host-world_session=/);
  assert.equal((await c.request('/api/world')).status,200);assert.equal((await c.request('/api/admin/users',{method:'POST',body:{},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await c.request('/api/admin/users')).headers.get('access-control-allow-origin'),null);assert.match((await c.request('/world')).headers.get('content-security-policy'),/default-src 'self'/);
 }finally{await r?.close();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('Socket.IO authenticates live/operator modes and Origin, rejects camera commands on live sockets, and revokes active sockets immediately',async()=>{
 const r=await start(),sockets=[];const open=options=>{const socket=connect(r.base,{autoConnect:false,reconnection:false,...options});sockets.push(socket);return socket;};
 const connected=socket=>new Promise((yes,no)=>{socket.once('connect',yes);socket.once('connect_error',no);socket.connect();});
 const denied=socket=>new Promise((yes,no)=>{socket.once('connect',()=>no(Error('Unauthorized socket connected')));socket.once('connect_error',e=>{assert.equal(e.message,'Autenticação necessária.');yes();});socket.connect();});
 try{const first=await r.auth.store.create('admin-test',password);for(const mode of ['live','operator','admin'])await denied(open({auth:{mode},transports:['websocket']}));
  const client=new Client(r.base);await client.login();const headers={Cookie:client.cookie,Origin:r.base};
  await denied(open({auth:{mode:'operator'},extraHeaders:{...headers,Origin:'https://evil.example'},transports:['websocket']}));
  const operator=open({auth:{mode:'operator'},extraHeaders:headers,transports:['websocket']});await connected(operator);
  const live=open({auth:{mode:'live'},extraHeaders:headers,transports:['polling']});await connected(live);
  const result=await new Promise(resolve=>operator.timeout(1000).emit('camera:goHome',{},(_error,data)=>resolve(data)));assert.equal(result.ok,true);
  await new Promise((yes,no)=>live.timeout(100).emit('camera:goHome',{},error=>error?yes():no(Error('Live socket accepted camera command'))));
  const gone=new Promise(resolve=>operator.once('disconnect',resolve));await client.request('/logout',{method:'POST'});await gone;assert.equal(operator.connected,false);
  await client.login();const second=open({auth:{mode:'operator'},extraHeaders:{Cookie:client.cookie,Origin:r.base},transports:['websocket']});await connected(second);
  const changed=new Promise(resolve=>second.once('disconnect',resolve));assert.equal((await client.request('/api/admin/password',{method:'POST',body:{currentPassword:password,password:password+' changed',confirmPassword:password+' changed'}})).status,200);await changed;assert.equal(second.connected,false);
  await client.login('admin-test',password+' changed');const third=open({auth:{mode:'live'},extraHeaders:{Cookie:client.cookie},transports:['websocket']});await connected(third);
  const other=await r.auth.store.create('other-admin',password),admin=new Client(r.base);await admin.login(other.username);
  const revoked=new Promise(resolve=>third.once('disconnect',resolve));assert.equal((await admin.request(`/api/admin/users/${first.id}/disable`,{method:'POST'})).status,200);await revoked;
  assert.equal(third.connected,false);await denied(open({auth:{mode:'live'},extraHeaders:{Cookie:client.cookie},transports:['websocket']}));
 }finally{for(const socket of sockets)socket.close();await r.close();}
});

test('live Socket.IO closes at the server session deadline and a replayed cookie cannot reconnect',async()=>{
 const r=await start({authConfig:{maxAgeHours:0.0003}});let socket;
 try{await r.auth.store.create('admin-test',password);const c=new Client(r.base);await c.login();
  socket=connect(r.base,{autoConnect:false,reconnection:false,auth:{mode:'live'},extraHeaders:{Cookie:c.cookie},transports:['websocket']});
  await new Promise((yes,no)=>{socket.once('connect',yes);socket.once('connect_error',no);socket.connect();});
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Socket did not expire')),2500);socket.once('disconnect',()=>{clearTimeout(timer);yes();});});
  assert.equal((await c.request('/api/world')).status,401);
 }finally{socket?.close();await r.close();}
});
