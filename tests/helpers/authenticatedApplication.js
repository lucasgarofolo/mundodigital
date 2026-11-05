// Regression fixtures log in through the real HTTP session flow; production has no auth bypass.
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const server=require('../../server');
const {createAuthStore}=require('../../lib/authStore');
const {isPublic}=require('../../lib/auth');
const nativeFetch=globalThis.fetch;
const registry=new Map();
function credentials(dataDir){fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'test-auth.json');
 if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
 const value={username:'fixture-admin',password:randomBytes(24).toString('hex'),secret:randomBytes(48).toString('hex')};fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});return value;}
const cookies=response=>(response.headers.getSetCookie?.()||[]).map(v=>v.split(';')[0]).join('; ');
async function login(base,entry){
 const before=await nativeFetch(base+'/api/auth/session'),initial=await before.json();
 const response=await nativeFetch(base+'/login',{method:'POST',headers:{Cookie:cookies(before),'Content-Type':'application/json','X-CSRF-Token':initial.csrfToken},
  body:JSON.stringify({username:entry.username,password:entry.password})});
 const body=await response.json();if(!response.ok)throw Error('Fixture login failed: '+JSON.stringify(body));
 return {cookie:cookies(response),csrfToken:body.csrfToken};
}
function entryFor(base){if(registry.has(base))return registry.get(base);const file=path.resolve('.test-data','auth-port-'+new URL(base).port+'.json');if(fs.existsSync(file)){const entry=JSON.parse(fs.readFileSync(file,'utf8'));registry.set(base,entry);return entry;}}
async function sessionFor(base){const entry=entryFor(base);if(!entry)return null;return entry.session??=login(base,entry);}
globalThis.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url||String(input));const entry=entryFor(url.origin);
 if(!entry||isPublic({path:url.pathname,method:options.method||'GET'}))return nativeFetch(input,options);const auth=await sessionFor(url.origin),headers=new Headers(options.headers);if(!headers.has('Cookie'))headers.set('Cookie',auth.cookie);
 if(!headers.has('X-CSRF-Token'))headers.set('X-CSRF-Token',auth.csrfToken);return nativeFetch(input,{...options,headers});};
async function createApplication(options={}){
 if(!options.dataDir||!path.resolve(options.dataDir).startsWith(path.resolve('.test-data')+path.sep))throw Error('Authenticated fixtures require an isolated .test-data directory.');
 const value=credentials(options.dataDir),previous=process.env.NODE_ENV;
 const setup=createAuthStore(options.dataDir);try{if(!setup.find(value.username))await setup.create(value.username,value.password);}finally{setup.close();}
 // Legacy production-debug tests use HTTP. Their world still runs in production after startup;
 // production TLS/cookie policy is tested separately through the unwrapped application.
 if(previous==='production')process.env.NODE_ENV='test';
 let runtime;try{runtime=await server.createApplication({...options,authConfig:{secret:value.secret,...options.authConfig}});}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
 runtime.server.on('listening',()=>{const port=runtime.server.address().port;for(const host of ['localhost','127.0.0.1'])registry.set(`http://${host}:${port}`,{...value});
  fs.writeFileSync(path.resolve('.test-data','auth-port-'+port+'.json'),JSON.stringify(value),{mode:0o600});});
 return {...runtime,testCredentials:value,publicFetch:nativeFetch};
}
module.exports={...server,createApplication,sessionFor,credentials,nativeFetch};
