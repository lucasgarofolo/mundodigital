const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const session=require('express-session');
const argon2=require('argon2');

const passwordOptions={type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1};
const problem=(message,status=400)=>Object.assign(new Error(message),{status});
function validateCredentials(username,password){
 if(typeof username!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(username))throw problem('Use um usuário de 3 a 64 caracteres: letras, números, ponto, hífen ou sublinhado.');
 if(typeof password!=='string'||password.length<12||password.length>256)throw problem('Use uma senha entre 12 e 256 caracteres. Frases são aceitas.');
 return username.toLowerCase();
}
function createAuthStore(dataDir,{logger=()=>{}}={}){
 fs.mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(path.join(dataDir,'auth.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS admin_users(
 id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'admin' CHECK(role='admin'),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login_at TEXT,auth_version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS admin_sessions(sid TEXT PRIMARY KEY,sess TEXT NOT NULL,expires_at INTEGER NOT NULL,user_id TEXT);
 CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
 CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions(user_id);`);
 const publicFields='id,username,role,active,created_at AS createdAt,updated_at AS updatedAt,last_login_at AS lastLoginAt';
 const get=id=>db.prepare('SELECT * FROM admin_users WHERE id=?').get(id);
 function invalidate(id){db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(id);}
 class SQLiteSessions extends session.Store{
  get(sid,cb){try{const row=db.prepare('SELECT sess,expires_at FROM admin_sessions WHERE sid=?').get(sid);
   if(!row||row.expires_at<=Date.now()){if(row)this.destroy(sid,()=>{});return cb(null,null);}cb(null,JSON.parse(row.sess));}catch(e){cb(e);}}
  set(sid,data,cb=()=>{}){try{const expires=Math.min(data.authUntil||Infinity,new Date(data.cookie.expires||Date.now()+43200000).getTime());
   db.prepare('INSERT INTO admin_sessions(sid,sess,expires_at,user_id) VALUES(?,?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at,user_id=excluded.user_id')
    .run(sid,JSON.stringify(data),expires,data.user?.id||null);cb();}catch(e){cb(e);}}
  touch(sid,data,cb=()=>{}){try{db.prepare('UPDATE admin_sessions SET expires_at=? WHERE sid=?').run(Math.min(data.authUntil||Infinity,new Date(data.cookie.expires).getTime()),sid);cb();}catch(e){cb(e);}}
  destroy(sid,cb=()=>{}){try{db.prepare('DELETE FROM admin_sessions WHERE sid=?').run(sid);cb();}catch(e){cb(e);}}
 }
 const sessions=new SQLiteSessions();const timer=setInterval(()=>{try{db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());}
  catch{logger('security:session-cleanup-failed',{timestamp:new Date().toISOString(),code:'SESSION_STORE_ERROR'});}},300000);timer.unref();
 return {db,sessions,get,find:username=>db.prepare('SELECT * FROM admin_users WHERE username=? COLLATE NOCASE').get(username),
  list:()=>db.prepare(`SELECT ${publicFields} FROM admin_users ORDER BY username`).all().map(u=>({...u,active:!!u.active})),
  async create(username,password){username=validateCredentials(username,password);const hash=await argon2.hash(password,passwordOptions),time=new Date().toISOString(),id=randomUUID();
   try{db.prepare('INSERT INTO admin_users(id,username,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,username,hash,time,time);}
   catch(e){if([1555,2067].includes(e.errcode)||e.code?.includes('SQLITE_CONSTRAINT'))throw problem('Não foi possível criar esse usuário. Verifique os dados.',409);throw e;}return this.list().find(u=>u.id===id);},
  verify:(user,password)=>argon2.verify(user.password_hash,password),
  loggedIn(id){db.prepare('UPDATE admin_users SET last_login_at=? WHERE id=?').run(new Date().toISOString(),id);},
  disable(id){db.exec('BEGIN IMMEDIATE');try{const user=get(id);if(!user)throw problem('Administrador não encontrado.',404);
   if(user.active&&db.prepare('SELECT count(*) AS n FROM admin_users WHERE active=1').get().n<=1)throw problem('O último administrador ativo não pode ser desativado.',409);
   db.prepare('UPDATE admin_users SET active=0,auth_version=auth_version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);invalidate(id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}},
  async changePassword(id,password,expectedVersion){const user=get(id);if(!user)throw problem('Administrador não encontrado.',404);
   validateCredentials(user.username,password);const hash=await argon2.hash(password,passwordOptions);
   db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('UPDATE admin_users SET password_hash=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND active=1 AND auth_version=?')
    .run(hash,new Date().toISOString(),id,expectedVersion??user.auth_version);if(!result.changes)throw problem('A sessão ou o usuário foi alterado. Entre novamente.',409);
    invalidate(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},
  valid(data){const user=data?.user&&get(data.user.id);return user?.active&&user.auth_version===data.authVersion&&data.authUntil>Date.now()?user:null;},
  close(){clearInterval(timer);db.close();}
 };
}
module.exports={createAuthStore,validateCredentials,passwordOptions};
