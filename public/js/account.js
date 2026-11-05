import {authSession,logout,loginRedirect} from './auth.js';
const bar=document.createElement('nav');bar.className='account-bar';bar.setAttribute('aria-label','Conta administrativa');
const admin=document.createElement('a');admin.href='/admin';admin.textContent='Administração';const exit=document.createElement('button');exit.type='button';exit.textContent='SAIR';exit.addEventListener('click',logout);bar.append(admin,exit);document.body.append(bar);
authSession().then(s=>{if(!s.authenticated)loginRedirect();}).catch(()=>{});
