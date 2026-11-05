import { createSelfieCamera } from './selfieCamera.js';
const form=document.getElementById('checkin-form'),submit=document.getElementById('submit');
const preview=document.getElementById('preview'),status=document.getElementById('status'),error=document.getElementById('error'),result=document.getElementById('result');
const SESSION_KEY='senai-participant-session';
const acknowledgement=document.getElementById('selfie-ai-acknowledged');
let photo,previewUrl,busy=false,config,session;
function updateSubmit(){submit.disabled=busy||!config||!acknowledgement.checked;}
acknowledgement.addEventListener('change',updateSubmit);
const fail=message=>{error.textContent=message;};
function saveSession(value){
 session=value;let saved=false;
 for(const storage of ['localStorage','sessionStorage'])try{if(value)window[storage].setItem(SESSION_KEY,JSON.stringify(value));else window[storage].removeItem(SESSION_KEY);saved=true;}catch{}
 return saved;
}
function readSession(){for(const storage of ['localStorage','sessionStorage'])try{const value=JSON.parse(window[storage].getItem(SESSION_KEY));if(value?.uuid&&value?.token)return value;}catch{}}
async function openPass(participant){
 let url=participant.passUrl;
 if(!url){
  const response=await fetch(`/api/participants/${session.uuid}/prepare-pass`,{method:'POST',headers:{Authorization:'Bearer '+session.token},signal:AbortSignal.timeout(15000)});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Não foi possível preparar seu crachá.');url=body.pass.passUrl;
 }
 location.replace(url);
}
async function configure(){
 try{
  const response=await fetch('/api/config');if(!response.ok)throw new Error();config=await response.json();
  if(config.selfiePrivacyPolicyUrl){const link=document.getElementById('selfie-privacy-policy');link.href=config.selfiePrivacyPolicyUrl;link.hidden=false;}
  document.getElementById('provider-note').textContent='Sua foto ajuda a preparar seu personagem e seu crachá. Você verá seu passe antes de entrar.';
  if(new URLSearchParams(location.search).has('new'))saveSession(null);
  else{
   session=readSession();
   if(session){
    form.hidden=true;result.hidden=false;
    const current=await fetch(`/api/participants/${session.uuid}/avatar-status`,{headers:{Authorization:'Bearer '+session.token},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(current.ok){await openPass((await current.json()).participant);return;}
    if([403,404,409].includes(current.status)){saveSession(null);form.hidden=false;result.hidden=true;}
    else throw new Error('Não foi possível recuperar seu crachá.');
   }
  }
  updateSubmit();
 }catch{form.hidden=false;result.hidden=true;document.getElementById('provider-note').textContent='Sem conexão. Recarregue a página para tentar novamente.';}
}
function selectPhoto(selected){
 if(busy||!selected)return;
 error.textContent='';photo=undefined;preview.hidden=true;document.getElementById('photo-placeholder').hidden=false;
 if(previewUrl)URL.revokeObjectURL(previewUrl);preview.removeAttribute('src');
 if(!['image/jpeg','image/png','image/webp'].includes(selected.type)){fail('Escolha uma foto JPEG, PNG ou WebP.');return;}
 if(selected.size>(config?.maxSelfieBytes||5*1024*1024)){fail('A selfie deve ter até 5 MB.');return;}
 previewUrl=URL.createObjectURL(selected);
 preview.onload=()=>{photo=selected;preview.hidden=false;document.getElementById('photo-placeholder').hidden=true;};
 preview.onerror=()=>fail('Não foi possível abrir esta foto. Escolha outra.');preview.src=previewUrl;
}
const selfieCamera=createSelfieCamera({onPhoto:selectPhoto,onError:fail,isBusy:()=>busy});
document.getElementById('photo').addEventListener('change',event=>{selfieCamera.stop();selectPhoto(event.target.files[0]);});
document.querySelector('label[for="photo"]').addEventListener('click',()=>selfieCamera.stop());
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!form.reportValidity())return;selfieCamera.stop();error.textContent='';
 if(!acknowledgement.checked){fail('Confirme que está ciente do processamento da selfie por serviços de inteligência artificial.');return;}
 if(!photo){fail('Tire uma selfie ou escolha uma foto antes de entrar.');return;}
 busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');
 const payload=new FormData();payload.set('name',document.getElementById('name').value);payload.set('email',document.getElementById('email').value);payload.set('selfie',photo);
 payload.set('selfieAiAcknowledged','true');
 form.hidden=true;result.hidden=false;status.textContent='';
 try{
  const response=await fetch('/api/check-in',{method:'POST',body:payload,signal:AbortSignal.timeout(120000)}),body=await response.json();
  if(!response.ok)throw new Error(body.error||'Não foi possível cadastrar.');
  if(!saveSession({uuid:body.participant.uuid,token:body.reviewToken}))throw new Error('Permita o armazenamento deste site no navegador para continuar com seu crachá.');
  photo=undefined;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=undefined;preview.onload=null;preview.onerror=null;preview.removeAttribute('src');document.getElementById('photo').value='';await openPass(body.participant);
 }catch(e){form.hidden=false;result.hidden=true;fail(e.message);}
 finally{busy=false;updateSubmit();form.removeAttribute('aria-busy');}
});
window.addEventListener('pagehide',()=>{photo=undefined;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=undefined;preview.onload=null;preview.onerror=null;preview.removeAttribute('src');document.getElementById('photo').value='';});
configure();
