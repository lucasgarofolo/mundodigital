const tools=document.getElementById('admin-tools'),button=document.getElementById('clear-participants');
const status=document.getElementById('clear-participants-status');
const params=new URLSearchParams(window.location.search);
if(params.get('demo')!=='1'&&params.get('lpcTest')!=='true'){
  fetch('/api/operation/config',{cache:'no-store'}).then(response=>response.json()).then(config=>{
    tools.hidden=!config.canResetParticipants;
  }).catch(()=>{});
}
button.addEventListener('click',async()=>{
  if(!window.confirm('Excluir todos os participantes do banco e suas fotos/avatares? Os e-mails ficarão livres para novos testes.'))return;
  button.disabled=true;status.textContent='Limpando participantes…';
  try{
    const {csrfToken}=await(await fetch('/api/auth/session',{cache:'no-store'})).json();
    const response=await fetch('/api/participants',{method:'DELETE',headers:{'X-SENAI-ADMIN':'reset-participants','X-CSRF-Token':csrfToken}});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível limpar os participantes.');
    // Also works if this display is recovering over HTTP without Socket.IO.
    const {game}=await import('./game.js');
    await game.scene.getScene('WorldScene').participantsClient?.synchronize();
    status.textContent=result.cleanupFailures?'Cadastros excluídos; alguns arquivos não puderam ser removidos.':
      `${result.deleted} participante(s) excluído(s). Você pode reutilizar o e-mail.`;
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
