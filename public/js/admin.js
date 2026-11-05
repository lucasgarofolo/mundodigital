import {authSession,authRequest,logout,loginRedirect,setSessionEnding} from './auth.js';
import {confirmAction} from './adminFeedback.js';
const $=id=>document.getElementById(id),status=$('auth-status');let me;
$('logout').addEventListener('click',logout);
async function refresh(){const {users}=await authRequest('/api/admin/users');$('admin-users').replaceChildren();for(const user of users){
 const li=document.createElement('li'),label=document.createElement('span');label.textContent=`${user.username} · ${user.role} · ${user.active?'ativo':'inativo'}${user.id===me.id?' · você':''}`;
 const lastLogin=document.createElement('small');lastLogin.className='account-role';lastLogin.textContent='Último login: '+(user.lastLoginAt?new Date(user.lastLoginAt).toLocaleString('pt-BR'):'ainda não entrou');label.append(document.createElement('br'),lastLogin);li.append(label);
 if(user.active){const disable=document.createElement('button');disable.textContent='DESATIVAR';disable.disabled=users.filter(u=>u.active).length<=1;
  disable.addEventListener('click',async()=>{if(!await confirmAction(`Desativar ${user.username}? As sessões serão encerradas.`))return;disable.disabled=true;disable.textContent='DESATIVANDO…';try{await authRequest(`/api/admin/users/${user.id}/disable`,{method:'POST'});status.textContent='Administrador desativado.';await refresh();}catch(e){status.textContent=e.message;disable.disabled=false;disable.textContent='DESATIVAR';}});li.append(disable);
  if(user.id!==me.id){const reset=document.createElement('button');reset.textContent='REDEFINIR SENHA';reset.addEventListener('click',()=>{$('reset-panel').hidden=false;$('reset-title').textContent='Redefinir senha · '+user.username;$('reset-password').elements.id.value=user.id;$('reset-panel').scrollIntoView();});li.append(reset);}}
 $('admin-users').append(li);}}
for(const [id,url]of [['create-admin','/api/admin/users'],['change-password','/api/admin/password'],['reset-password',null]])$(id).addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),body=Object.fromEntries(new FormData(form));button.disabled=true;status.textContent='Salvando…';if(id==='change-password')setSessionEnding(true);
 try{const data=await authRequest(url||`/api/admin/users/${body.id}/password`,{method:'POST',body});form.reset();if(data.loginRequired){location.replace('/login');return;}status.textContent='Alteração concluída.';$('reset-panel').hidden=true;await refresh();}catch(e){setSessionEnding(false);status.textContent=e.message;}finally{button.disabled=false;}});
try{const session=await authSession();if(!session.authenticated)loginRedirect();else{me=session.user;$('account-name').textContent='Conectado como '+me.username;await refresh();}}catch(e){status.textContent=e.message;}
