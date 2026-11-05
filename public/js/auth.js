export async function authSession(){const r=await fetch('/api/auth/session',{cache:'no-store'});if(!r.ok)throw Error('Não foi possível verificar a sessão.');return r.json();}
let loggingOut=false;
export function setSessionEnding(value){loggingOut=value===true;}
export function loginRedirect(force=false){if(!loggingOut||force)location.replace('/login?next='+encodeURIComponent(location.pathname+location.search));}
export async function authRequest(url,{method='GET',body}={}){const session=await authSession();if(!session.authenticated){loginRedirect(true);throw Error('Entre novamente.');}
 const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===401){loginRedirect(true);throw Error('Sua sessão expirou.');}const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
export async function logout(){loggingOut=true;try{const session=await authSession();const response=await fetch('/logout',{method:'POST',headers:{'X-CSRF-Token':session.csrfToken}});
 if(!response.ok&&response.status!==401)throw Error('Não foi possível confirmar a saída. Tente novamente.');location.replace('/login');
 }catch{loggingOut=false;const status=document.getElementById('auth-status');if(status)status.textContent='Não foi possível confirmar a saída. Tente novamente.';else alert('Não foi possível confirmar a saída. Tente novamente.');}}
const form=document.getElementById('login-form');
if(form)form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button'),status=document.getElementById('auth-status');button.disabled=true;status.textContent='Entrando…';
 try{const session=await authSession(),response=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({username:form.username.value,password:form.password.value,next:new URLSearchParams(location.search).get('next')})});
  form.password.value='';const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível entrar.');location.replace(data.next);
 }catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
