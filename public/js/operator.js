import {WORLD} from './world-config.js';

import {loginRedirect} from './auth.js';
const $=id=>document.getElementById(id);
const input=$('participant-search'),results=$('search-results'),status=$('search-status'),error=$('operator-error');
const inlinePanel=$('world-controls');
let socket,queryTimer,request,searchRevision=0,busy=false,cameraRevision=-1,cameraInstance;
const rows=new Map();
const location=p=>`${WORLD.blocks[p.currentBlock]?.name||p.currentBlock} · ${WORLD.blocks[p.currentBlock]?.areas[p.currentArea]?.name||p.currentArea}`;
const statusText=p=>p.status==='INACTIVE'?'Participante indisponível':p.available?(p.status==='ENTERING'?'Entrando no Mundo // Digital':'No Mundo // Digital'):'Ainda não entrou no Mundo // Digital';
function enabled(){
  $('camera-home').disabled=!socket?.connected||busy;
  for(const row of rows.values())row.button.disabled=!socket?.connected||busy||!row.data.available;
}
function showState(state){
  if(!state||(state.instanceId===cameraInstance&&state.revision<cameraRevision))return;
  cameraInstance=state.instanceId;
  cameraRevision=state.revision;
  const p=state.participant,focused=state.cameraMode==='FOCUS_PARTICIPANT';
  $('camera-title').textContent=focused?(p?.name||'Participante selecionado'):'Sala de Acesso';
  $('camera-location').textContent=focused&&p?location(p):'Bloco B · Superior · Sala de Acesso';
  $('camera-status').textContent=focused?(state.available?'Acompanhando · até o próximo comando do operador.':'Participante não está mais disponível no mundo.'):'Visão de entrada do Mundo // Digital.';
  if(p&&rows.has(p.uuid)){
    const row=rows.get(p.uuid);row.data={...p,available:state.available};
    row.location.textContent=location(p);row.status.textContent=statusText(row.data);enabled();
  }
}
async function command(event,payload={}){
  if(!socket?.connected||busy)return;
  busy=true;error.textContent='';enabled();
  socket.timeout(6000).emit(event,payload,async(timeout,result)=>{
    busy=false;
    if(timeout)error.textContent='Comando não confirmado. Confira a conexão e tente novamente.';
    else if(!result?.ok){error.textContent=result?.error||'Não foi possível enviar o comando.';try{await checkAccess();}catch{}}
    else {
      showState(result.state);
      if(inlinePanel){results.hidden=true;input.blur();}
    }
    enabled();
  });
}
function connect(){
  socket?.disconnect();cameraRevision=-1;
  if(!window.io){error.textContent='Não foi possível conectar ao controle. Recarregue a página.';return;}
  socket=window.io({auth:{mode:'operator'}});
  socket.on('connect',()=>{$('connection-status').textContent='● Controle conectado';enabled();});
  socket.on('disconnect',reason=>{if(reason==='io server disconnect')loginRedirect();$('connection-status').textContent='Reconectando ao controle…';enabled();});
  socket.on('connect_error',event=>{
    $('connection-status').textContent='Sem conexão com o controle';enabled();
    if(event.message==='Autenticação necessária.')loginRedirect();
  });
  socket.on('camera:state',showState);
}
function render(participants){
  rows.clear();results.replaceChildren();
  if(inlinePanel)results.hidden=participants.length===0;
  for(const p of participants){
    const li=document.createElement('li'),info=document.createElement('div');li.dataset.uuid=p.uuid;
    const name=document.createElement('div');name.className='participant-name';name.textContent=p.name;
    const place=document.createElement('p');place.className='participant-location';place.textContent=location(p);
    const state=document.createElement('p');state.className='participant-status';state.textContent=statusText(p);
    const id=document.createElement('p');id.className='participant-id';id.textContent=`ID ${p.uuid.slice(-8)}`;
    const button=document.createElement('button');button.type='button';button.textContent='ENCONTRAR';button.setAttribute('aria-label',`Encontrar ${p.name}, ID ${p.uuid.slice(-8)}`);
    button.addEventListener('click',()=>command('camera:focusParticipant',{participantUuid:p.uuid}));
    info.append(name,place,state,id);li.append(info,button);results.append(li);
    rows.set(p.uuid,{data:p,button,location:place,status:state});
  }
  enabled();
}
async function search(revision){
  request=new AbortController();status.textContent='Pesquisando…';
  try{
    const response=await fetch(`/api/participants/search?q=${encodeURIComponent(input.value.trim())}`,{cache:'no-store',signal:request.signal});
    const data=await response.json();if(revision!==searchRevision)return;
    if(!response.ok){if(response.status===401)loginRedirect();throw new Error(data.error||'Não foi possível pesquisar.');}
    render(data.participants);status.textContent=data.participants.length?`${data.participants.length} resultado(s)${data.participants.length===20?' · refine o nome para encontrar outras pessoas':''}.`:'Nenhum participante encontrado.';
  }catch(e){if(e.name!=='AbortError'&&revision===searchRevision){status.textContent='Pesquisa indisponível.';error.textContent=e.message;}}
}
input.addEventListener('input',()=>{
  clearTimeout(queryTimer);request?.abort();const revision=++searchRevision;error.textContent='';
  render([]);
  if(input.value.trim().length<2){status.textContent='Digite pelo menos 2 caracteres.';return;}
  queryTimer=setTimeout(()=>search(revision),300);
});
$('camera-home').addEventListener('click',()=>command('camera:goHome'));
async function checkAccess(){
 const response=await fetch('/api/operator/session',{cache:'no-store'});
 if(response.status===401){loginRedirect();return;}
 if(!response.ok)throw Error('Não foi possível verificar a sessão.');
 $('operator-controls').hidden=false;if(!socket?.connected)connect();
}
const params=new URLSearchParams(window.location.search);
const preview=inlinePanel&&(params.get('demo')==='1'||params.get('lpcTest')==='true');
if(preview){inlinePanel.hidden=true;document.body.classList.remove('with-world-controls');}
else checkAccess().catch(()=>{error.textContent='Não foi possível abrir o controle. Confira o servidor e recarregue a página.';});
if(inlinePanel&&!preview){
  const toggle=$('toggle-world-controls'),content=$('world-controls-content');
  const setCollapsed=collapsed=>{
    content.hidden=collapsed;results.hidden=true;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.textContent=collapsed?'Mostrar controles':'Recolher controles';
    inlinePanel.classList.toggle('is-collapsed',collapsed);
    try{sessionStorage.setItem('senai-world-controls-collapsed',String(collapsed));}catch{}
  };
  try{setCollapsed(sessionStorage.getItem('senai-world-controls-collapsed')==='true');}catch{setCollapsed(false);}
  toggle.addEventListener('click',()=>setCollapsed(!content.hidden));
  input.addEventListener('focus',()=>{if(rows.size)results.hidden=false;});
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();results.hidden=true;input.blur();}
  });
  document.addEventListener('pointerdown',event=>{if(!inlinePanel.contains(event.target))results.hidden=true;});
  inlinePanel.addEventListener('wheel',event=>event.stopPropagation());
}
window.addEventListener('pagehide',()=>{clearTimeout(queryTimer);request?.abort();socket?.disconnect();});
