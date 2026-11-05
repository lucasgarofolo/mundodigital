const session=require('express-session'),express=require('express');
const helmet=require('helmet');
const {rateLimit}=require('express-rate-limit');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const path=require('node:path');
const argon2=require('argon2');
const {createAuthStore,passwordOptions}=require('./authStore');
const token=()=>randomBytes(32).toString('base64url');
const safeUser=user=>({id:user.id,username:user.username,role:user.role});
const returnTo=value=>typeof value==='string'&&/^\/(world|tela|operator|admin)(?:[/?#]|$)/.test(value)&&!/[\r\n\\]/.test(value)?value:'/world';
const publicOwner=/^\/api\/participants\/[0-9a-f-]{36}\/(avatar-status|approve-avatar|prepare-pass)$/i;
function isPublic(req){const p=req.path;
 // Static serving decodes paths. Reject traversal before checking a public asset prefix.
 try{const decoded=decodeURIComponent(p);if(/[\\\0]/.test(decoded)||path.posix.normalize(decoded)!==decoded)return false;}catch{return false;}
 if(req.method==='GET'||req.method==='HEAD')return ['/checkin','/check-in','/check-in.html','/login','/login.html','/health','/api/config','/api/auth/session','/favicon.ico'].includes(p)||
  /^\/(pass|api\/pass)\/[0-9a-f-]{36}$/i.test(p)||/^\/generated\/participants\/[0-9a-f-]{36}\/(portrait|story)\.png$/i.test(p)||
  /^\/avatars\/[0-9a-f-]{36}(?:-[0-9a-f]{16})?\.png$/i.test(p)||p.startsWith('/assets/avatars/lpc/')||
  ['/js/check-in.js','/js/selfieCamera.js','/js/pass.js','/js/auth.js','/css/check-in.css','/css/pass.css','/css/auth.css'].includes(p)||publicOwner.test(p)&&p.endsWith('/avatar-status');
 return req.method==='POST'&&(p==='/login'||p==='/api/check-in'||publicOwner.test(p)&&!p.endsWith('/avatar-status'));
}
function createAuth({app,io,dataDir,logger=()=>{},config={}}){
 const production=process.env.NODE_ENV==='production',secret=config.secret??process.env.SESSION_SECRET;
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw new Error('Configure SESSION_SECRET com pelo menos 32 bytes aleatórios antes de iniciar o servidor.');
 const hours=Number(config.maxAgeHours??process.env.SESSION_MAX_AGE_HOURS??12);
 if(!Number.isFinite(hours)||hours<=0||hours>168)throw new Error('SESSION_MAX_AGE_HOURS deve estar entre 0 e 168 horas.');
 const maxAge=hours*3600000,cookieName=production?'__Host-world_session':'world_session';
 const cookie={httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge};
 const origin=config.origin??process.env.APP_ORIGIN;
 if(origin){const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol)||production&&u.protocol!=='https:')throw new Error('APP_ORIGIN deve conter apenas a origem pública; use HTTPS em produção.');}
 if(production&&!origin)throw new Error('Configure APP_ORIGIN com a origem HTTPS pública em produção.');
 const proxy=config.trustProxy??process.env.TRUST_PROXY;
 if(proxy)app.set('trust proxy',/^\d+$/.test(String(proxy))?Number(proxy):String(proxy).split(',').map(s=>s.trim()));
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],
  imgSrc:["'self'",'data:','blob:'],connectSrc:["'self'"],workerSrc:["'self'",'blob:'],upgradeInsecureRequests:production?[]:null}},
  strictTransportSecurity:production?undefined:false}));
 const store=createAuthStore(dataDir,{logger});
 const middleware=session({name:cookieName,secret,store:store.sessions,resave:false,saveUninitialized:false,cookie});
 app.use(middleware);io.engine.use(middleware);
 const clear=res=>res.clearCookie(cookieName,{httpOnly:true,secure:production,sameSite:'lax',path:'/'});
 const originOK=req=>{
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const value=req.headers.origin;if(!value)return true;
  try{return new URL(value).origin===(origin||`${req.secure?'https':'http'}://${req.headers.host}`);}catch{return false;}
 };
 const userFor=req=>store.valid(req.session);
 function csrf(req,res,next){const expected=req.session?.csrfToken,value=req.get('X-CSRF-Token');
  if(!originOK(req)||typeof expected!=='string'||typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||expected.length!==value.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(value))){res.status(403).json({error:'Solicitação inválida. Recarregue a página.'});return;}next();}
 function requireAuth(req,res,next){const user=userFor(req);res.set('Cache-Control','no-store');
   if(!user){if(req.session?.user){req.session.destroy(()=>{});clear(res);}if(req.path==='/api'||req.path.startsWith('/api/')||req.method!=='GET'&&req.method!=='HEAD')res.status(401).json({error:'Autenticação necessária.'});
   else res.redirect('/login?next='+encodeURIComponent(returnTo(req.originalUrl)));return;}req.authUser=user;next();}
 const requireAdmin=(req,res,next)=>requireAuth(req,res,()=>req.authUser.role==='admin'?next():res.status(403).json({error:'Acesso negado.'}));
 const audit=(event,req,user)=>logger('security:'+event,{timestamp:new Date().toISOString(),...(user?{id:user.id,username:user.username}:{}),ip:req.ip});
 const invalidateUser=id=>io.in('auth-user:'+id).disconnectSockets(true);
 app.get(['/login','/login.html'],(req,res)=>{res.set('Cache-Control','no-store');if(userFor(req))res.redirect(returnTo(req.query.next));else res.sendFile(path.join(__dirname,'../public/login.html'));});
 app.get('/api/auth/session',(req,res)=>{res.set('Cache-Control','no-store');req.session.csrfToken??=token();const user=userFor(req);
  res.json({authenticated:!!user,user:user?safeUser(user):null,csrfToken:req.session.csrfToken,minPasswordLength:12});});
 const limiter=rateLimit({windowMs:config.loginWindowMs??900000,limit:config.loginLimit??10,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Muitas tentativas. Aguarde alguns minutos e tente novamente.'}});
 const dummy=argon2.hash(token(),passwordOptions);let verifying=0;
 app.post('/login',limiter,express.json({limit:'4kb'}),csrf,async(req,res,next)=>{try{
  if(verifying>=4){res.status(429).json({error:'Muitas tentativas. Aguarde alguns instantes.'});return;}
  verifying++;
  try{
  const {username,password}=req.body||{};let user;
  if(typeof username==='string'&&username.length<=64&&typeof password==='string'&&password.length<=256)user=store.find(username);
  const valid=await argon2.verify(user?.password_hash||await dummy,typeof password==='string'&&password.length<=256?password:'');
  if(!user?.active||!valid){audit('login-failure',req,user);res.status(401).json({error:'Usuário ou senha inválidos.'});return;}
  // Recheck after expensive hashing in case an administrator revoked the account concurrently.
  if(store.get(user.id)?.auth_version!==user.auth_version||!store.get(user.id)?.active){res.status(401).json({error:'Usuário ou senha inválidos.'});return;}
  await new Promise((yes,no)=>req.session.regenerate(e=>e?no(e):yes()));
  req.session.user=safeUser(user);req.session.authVersion=user.auth_version;req.session.authUntil=Date.now()+maxAge;req.session.csrfToken=token();
  await new Promise((yes,no)=>req.session.save(e=>e?no(e):yes()));store.loggedIn(user.id);audit('login-success',req,user);
  res.json({user:safeUser(user),next:returnTo(req.body?.next),csrfToken:req.session.csrfToken});
  }finally{verifying--;}
 }catch(e){next(e);}});
 app.use((req,res,next)=>{
  if(isPublic(req))return next();
  requireAuth(req,res,()=>['GET','HEAD','OPTIONS'].includes(req.method)?next():csrf(req,res,next));
 });
 app.post('/logout',(req,res,next)=>{const user=req.authUser,id=req.sessionID;req.session.destroy(error=>{if(error)return next(error);clear(res);io.in('auth-session:'+id).disconnectSockets(true);audit('logout',req,user);res.redirect(303,'/login');});});
 app.get(['/admin','/admin.html'],requireAdmin,(_req,res)=>res.sendFile(path.join(__dirname,'../public/admin.html')));
 app.get('/api/admin/users',requireAdmin,(_req,res)=>res.json({users:store.list()}));
 app.post('/api/admin/users',requireAdmin,express.json({limit:'4kb'}),async(req,res,next)=>{try{if(req.body?.password!==req.body?.confirmPassword)throw Object.assign(new Error('As senhas não coincidem.'),{status:400});
  const user=await store.create(req.body?.username,req.body?.password);audit('admin-created',req,user);res.status(201).json({user});}catch(e){next(e);}});
 app.post('/api/admin/users/:id/disable',requireAdmin,(req,res,next)=>{try{const user=store.get(req.params.id);store.disable(req.params.id);invalidateUser(req.params.id);audit('admin-disabled',req,user);res.json({ok:true});}catch(e){next(e);}});
 app.post('/api/admin/users/:id/password',requireAdmin,express.json({limit:'4kb'}),async(req,res,next)=>{try{
  if(req.params.id===req.authUser.id)throw Object.assign(new Error('Use a troca de senha própria com a senha atual.'),{status:400});
  if(req.body?.password!==req.body?.confirmPassword)throw Object.assign(new Error('As senhas não coincidem.'),{status:400});
  await store.changePassword(req.params.id,req.body?.password);invalidateUser(req.params.id);audit('password-reset',req,store.get(req.params.id));res.json({ok:true});}catch(e){next(e);}});
 app.post('/api/admin/password',requireAdmin,express.json({limit:'4kb'}),async(req,res,next)=>{try{
  if(typeof req.body?.currentPassword!=='string'||req.body?.currentPassword.length>256||!await store.verify(req.authUser,req.body?.currentPassword))throw Object.assign(new Error('Senha atual inválida.'),{status:400});
  if(req.body?.password!==req.body?.confirmPassword)throw Object.assign(new Error('As senhas não coincidem.'),{status:400});
  await store.changePassword(req.authUser.id,req.body?.password,req.authUser.auth_version);invalidateUser(req.authUser.id);clear(res);audit('password-changed',req,req.authUser);res.json({ok:true,loginRequired:true});}catch(e){next(e);}});
 io.use((socket,next)=>{try{const user=userFor(socket.request),mode=socket.handshake.auth.mode;if(!originOK(socket.request)||!user||!['live','operator','admin'].includes(mode)||mode!=='live'&&user.role!=='admin')return next(new Error('Autenticação necessária.'));next();}catch{next(new Error('Autenticação necessária.'));}});
 io.on('connection',socket=>{const req=socket.request;let user;try{user=userFor(req);}catch{}if(!user){socket.disconnect(true);return;}
  socket.join('auth-user:'+user.id);socket.join('auth-session:'+req.sessionID);
  const expiry=setTimeout(()=>socket.disconnect(true),Math.max(1,req.session.authUntil-Date.now()));expiry.unref();socket.on('disconnect',()=>clearTimeout(expiry));
  socket.use((_packet,next)=>{req.session.reload(error=>{let allowed=false;try{const current=userFor(req);allowed=!error&&originOK(req)&&!!current&&(socket.handshake.auth.mode==='live'||current.role==='admin');}catch{}
   if(!allowed){socket.emit('auth:expired');socket.disconnect(true);return next(new Error('Autenticação necessária.'));}next();});});
 });
 return {store,requireAuth,requireAdmin,csrf,originOK,userFor,close:()=>store.close()};
}
module.exports={createAuth,isPublic,returnTo};
