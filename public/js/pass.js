const uuid=location.pathname.split('/').pop(),card=document.getElementById('pass-card'),status=document.getElementById('pass-status');
const share=document.getElementById('share-pass'),save=document.getElementById('save-story'),retry=document.getElementById('retry-portrait'),enter=document.getElementById('enter-world');
let timer,storyFile,storyUrl,downloadUrl,session,stopped=false,lastCard,lastData,entryBusy=false,requestVersion=0;
for(const storage of ['localStorage','sessionStorage'])try{const saved=JSON.parse(window[storage].getItem('senai-participant-session'));if(saved?.uuid===uuid&&saved?.token){session=saved;break;}}catch{}
function render(data){
 lastData=data;const preparing=data.credentialState==='ASSETS_PROCESSING',entered=data.shareAllowed;
 document.getElementById('pass-processing').hidden=!preparing;card.hidden=preparing;
 document.getElementById('entry-actions').hidden=preparing||entered||!session;
 document.getElementById('share-actions').hidden=!entered;
 enter.disabled=entryBusy||!data.canEnter;
 const title=document.getElementById('pass-title'),intro=document.getElementById('pass-intro');
 if(preparing){title.textContent='Preparando seu crachá do Mundo // Digital…';intro.textContent='Seu passe para uma nova experiência está a caminho.';}
 else if(data.credentialState==='PASS_READY'){title.textContent='Seu passe está pronto.';intro.textContent=session?'Este é o seu crachá do Mundo // Digital. Agora você pode entrar.':'Este é um passe do Mundo // Digital. A entrada é confirmada no navegador do participante.';}
 else if(data.participantStatus==='INACTIVE'){title.textContent='Seu passe continua com você.';intro.textContent='Seu avatar foi removido do mundo. Seu crachá e os arquivos gerados continuam disponíveis.';}
 else if(data.credentialState==='ACTIVE'){title.textContent='Você já está no Mundo // Digital.';intro.textContent='Encontre seu personagem na Sala 5 e leve seu crachá com você.';}
 else{title.textContent='Olhe para a TV 👀';intro.textContent='Tudo pronto! Seu avatar está entrando no Mundo // Digital.';}
 retry.hidden=!session||!entered||data.portraitStatus!=='FAILED'||!data.canRetryPortrait;
 status.textContent=preparing?'':data.portraitStatus==='FAILED'?'Seu crachá continua válido. Não conseguimos preparar o portrait desta vez.':
  data.portraitStatus!=='READY'?'Seu portrait está sendo preparado e aparecerá aqui automaticamente.':
  !entered?'Entre no Mundo // Digital para guardar e compartilhar seu crachá.':
  data.storyStatus==='FAILED'?'A imagem para compartilhar está temporariamente indisponível.':
  data.storyStatus!=='READY'?'Preparando a imagem do seu crachá para baixar e compartilhar…':'Guarde seu crachá ou compartilhe pelo menu do celular.';
}
async function loadStory(data,version){
 if(!data.shareAllowed){share.disabled=true;save.disabled=true;return;}
 if(data.storyUrl===storyUrl&&storyFile){share.disabled=false;save.disabled=false;return;}
 storyFile=null;share.disabled=true;save.disabled=true;if(!data.storyUrl)return;
 const response=await fetch(data.storyUrl);if(!response.ok)throw new Error('Não foi possível carregar a imagem para compartilhar.');
 const blob=await response.blob();if(stopped||version!==requestVersion)return;
 if(downloadUrl)URL.revokeObjectURL(downloadUrl);
 storyFile=new File([blob],`mundo-digital-${data.passNumber}.png`,{type:'image/png'});storyUrl=data.storyUrl;downloadUrl=URL.createObjectURL(storyFile);
 share.disabled=false;save.disabled=false;
}
async function refresh(){
 if(stopped)return;clearTimeout(timer);const version=++requestVersion;let pending=true;
 try{
  const response=await fetch('/api/pass/'+encodeURIComponent(uuid),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok){if(response.status===404){pending=false;throw new Error('Passe não encontrado.');}throw new Error('Sem conexão. Tentaremos novamente em instantes.');}
  const body=await response.json();if(stopped||version!==requestVersion)return;
  if(body.cardHtml!==lastCard){card.innerHTML=body.cardHtml;lastCard=body.cardHtml;}
  render(body.pass);await loadStory(body.pass,version);
  pending=body.pass.participantStatus!=='INACTIVE'&&(body.pass.credentialState==='ASSETS_PROCESSING'||['ENTRY_SCHEDULED','ENTERING'].includes(body.pass.credentialState))||
   ['PENDING','PROCESSING'].includes(body.pass.portraitStatus)||(body.pass.shareAllowed&&['PENDING','PROCESSING'].includes(body.pass.storyStatus));
 }catch(error){if(!stopped&&version===requestVersion)status.textContent=error.message;}finally{if(pending&&!stopped&&version===requestVersion)timer=setTimeout(refresh,1000);}
}
enter.addEventListener('click',async()=>{
 if(entryBusy||!session||!lastData?.canEnter)return;
 entryBusy=true;enter.disabled=true;requestVersion++;clearTimeout(timer);
 try{
  const response=await fetch(`/api/participants/${encodeURIComponent(uuid)}/approve-avatar`,{method:'POST',keepalive:true,headers:{Authorization:'Bearer '+session.token},signal:AbortSignal.timeout(15000)});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Não foi possível confirmar sua entrada.');
  render({...lastData,credentialState:'ENTRY_SCHEDULED',canEnter:false,shareAllowed:true});
  entryBusy=false;await refresh();
 }catch(error){entryBusy=false;await refresh();status.textContent=error.message;}
});
function download(){if(!storyFile||!lastData?.shareAllowed)return;const link=document.createElement('a');link.href=downloadUrl;link.download=storyFile.name;document.body.appendChild(link);link.click();link.remove();status.textContent='Download iniciado. Compartilhe no Instagram.';}
save.addEventListener('click',download);
share.addEventListener('click',async()=>{
 if(!storyFile||!lastData?.shareAllowed)return;
 try{
  if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[storyFile]})){
   await navigator.share({files:[storyFile],title:'Meu passe Mundo // Digital'});status.textContent='Imagem enviada ao compartilhamento do seu dispositivo.';
  }else download();
 }catch(error){if(error.name!=='AbortError')download();}
});
retry.addEventListener('click',async()=>{
 if(!session||retry.disabled)return;retry.disabled=true;
 try{
  const {csrfToken}=await(await fetch('/api/auth/session',{cache:'no-store'})).json();
  const response=await fetch(`/api/participants/${encodeURIComponent(uuid)}/retry-portrait`,{method:'POST',headers:{Authorization:'Bearer '+session.token,'X-CSRF-Token':csrfToken},signal:AbortSignal.timeout(15000)});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Não foi possível tentar novamente.');
  await refresh();
 }catch(error){status.textContent=error.message;}finally{retry.disabled=false;}
});
window.addEventListener('pagehide',()=>{stopped=true;requestVersion++;clearTimeout(timer);if(downloadUrl)URL.revokeObjectURL(downloadUrl);});
window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;storyFile=null;storyUrl=null;refresh();}});
refresh();
