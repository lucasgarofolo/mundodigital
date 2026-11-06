import {authSession,authRequest,loginRedirect} from './auth.js';
import {notice,confirmAction} from './adminFeedback.js';
import {WORLD} from './world-config.js';
const $=id=>document.getElementById(id),table=$('participant-table');
let page=1,total=0,selected=null,socket,searchTimer,refreshTimer,refreshing=false,again=false,stopped=false,listRevision=0,detailRevision=0,acting=false;
const busy=new Set();
const time=value=>value?new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const badge=value=>el('span',value,'status-badge '+(['READY','ACTIVE','ONLINE','OK','REMOVIDA'].includes(value)?'good':['FAILED','FALLBACK','WARNING','ERROR','DELETE_FAILED'].includes(value)?'warning':'muted'));
const selfie=value=>({DELETED:'REMOVIDA',PROCESSING:'PROCESSANDO',AVAILABLE:'DISPONÍVEL',UNAVAILABLE:'INDISPONÍVEL'}[value]||value);
const location=p=>`${WORLD.blocks[p.currentBlock]?.name||p.currentBlock||'—'} · ${WORLD.blocks[p.currentBlock]?.areas[p.currentArea]?.name||p.currentArea||'—'}`;
const actions=[['locate','locate','LOCALIZAR NA TV'],['retryLpc','retry-lpc','REPROCESSAR AVATAR'],['retryPortrait','retry-portrait','REPROCESSAR PORTRAIT'],['regenerateStory','regenerate-story','REGERAR STORY'],['forceEntry','force-entry','FORÇAR ENTRADA'],['cancelEntry','cancel-entry','CANCELAR ENTRADA'],['remove','remove','REMOVER DO MUNDO'],['deleteRegistration','delete-registration','EXCLUIR CADASTRO'],['retryDelete','retry-selfie-delete','TENTAR REMOVER NOVAMENTE']];
const confirmations={remove:'Remover este avatar do mundo? O cadastro, os assets e o crachá serão preservados.',
 'cancel-entry':'Cancelar esta entrada agendada? O participante voltará à revisão do passe.',
 'delete-registration':'Excluir definitivamente este cadastro e seus arquivos (avatar, portrait, crachá e eventual selfie temporária)? O e-mail ficará disponível para novo check-in. Esta ação não pode ser desfeita.'};
async function runAction(uuid,name,button){
 if(acting||busy.has(uuid+':'+name))return;
 if(confirmations[name]&&!await confirmAction(confirmations[name]))return;
 const key=uuid+':'+name,label=button.textContent;busy.add(key);acting=true;button.disabled=true;button.textContent='PROCESSANDO…';
 try{const result=await authRequest(name==='home'?'/api/admin/camera/home':`/api/admin/participants/${uuid}/actions/${name}`,{method:'POST',body:{requestId:crypto.randomUUID(),...(confirmations[name]?{confirm:true}:{})}});if(name==='delete-registration'&&selected===uuid){selected=null;detailRevision++;$('participant-detail').close();}notice(result.message);}
 catch(e){notice(e.message);}finally{busy.delete(key);acting=false;button.disabled=false;button.textContent=label;await refresh();}
}
function row(p){const tr=el('tr');tr.dataset.uuid=p.uuid;const name=el('td',p.name);name.append(el('small',p.uuid.slice(0,8)));tr.append(name);
 for(const [index,value]of [p.status,p.avatarStatus,p.portraitStatus,selfie(p.selfieStatus)].entries()){const td=el('td');td.append(badge(value));if(index===3&&p.cleanupWaiting)td.append(el('p','Selfie aguardando cleanup.'));tr.append(td);}
 tr.append(el('td',location(p)),el('td',p.enteredAt?date(p.enteredAt):p.scheduledEntryAt?date(p.scheduledEntryAt):'—'));
 const buttons=el('td'),view=el('button','VER');view.type='button';view.addEventListener('click',()=>openDetail(p.uuid));buttons.append(view);
 const locate=el('button','LOCALIZAR','locate-participant');locate.type='button';locate.disabled=!p.actions.locate.allowed||acting;locate.title=p.actions.locate.reason||'Acompanhar este UUID na TV';locate.addEventListener('click',()=>runAction(p.uuid,'locate',locate));buttons.append(locate);tr.append(buttons);return tr;
}
async function list(){const revision=++listRevision;const q=$('admin-participant-search').value.trim(),filter=$('participant-filter').value;
 const data=await authRequest(`/api/admin/participants?q=${encodeURIComponent(q)}&filter=${filter}&page=${page}&limit=25`);if(stopped||revision!==listRevision)return;if(acting||$('confirm-action').open){again=true;return;}
 total=data.total;if(page>1&&(page-1)*25>=total){page=Math.max(1,Math.ceil(total/25));return list();}
 table.replaceChildren(...data.participants.map(row));$('table-message').textContent=total?'':'Nenhum participante encontrado.';
 $('pagination-status').textContent=`${total} participante(s) · página ${page} de ${Math.max(1,Math.ceil(total/25))}`;$('previous-page').disabled=page<=1;$('next-page').disabled=page*25>=total;
}
function renderSummary(data){for(const node of document.querySelectorAll('.metric'))node.querySelector('dd').textContent=data.counters?.[node.dataset.key]??'—';
 const names={server:'Server',database:'Banco',tv:'TV / World',socket:'Socket.IO',openrouter:'OpenRouter',cloudflare:'Cloudflare',selfie:'Selfie Cleanup'};
 $('system-status').replaceChildren(...Object.entries(data.system).map(([key,value])=>{const block=el('div',undefined,'system-item');block.dataset.service=key;const header=el('header');header.append(el('span',names[key]),badge(value.status));block.append(header);
  if(value.configured!==undefined)block.append(el('p',value.configured?'CONFIGURADO':'NÃO CONFIGURADO'));
  if(value.lastAttempt)block.append(el('p','Última tentativa: '+time(value.lastAttempt)));if(value.lastSuccess)block.append(el('p','Último sucesso: '+time(value.lastSuccess)));
  if(value.lastError)block.append(el('p',`Último erro: ${value.lastError.status?value.lastError.status+' · ':''}${value.lastError.code} · ${time(value.lastError.at)}`));
  if(value.durationMs!==undefined)block.append(el('p',`Latência observada: ${value.durationMs} ms`));if(value.lastCost!==undefined)block.append(el('p',`Última chamada: US$ ${value.lastCost.toFixed(8)} · execução: US$ ${value.sessionCost.toFixed(8)}`));
  if(value.connections!==undefined)block.append(el('p',`${value.connections} conexão(ões)${key==='tv'?' do mundo':''}`));
  if(value.deleteFailed!==undefined)block.append(el('p',`${value.deleteFailed??'—'} falha(s) · ${value.activeConsumers} consumidor(es) ativo(s)`));return block;}));
 const queues=data.queues;$('queue-status').replaceChildren(...[['LPC',queues.lpc],['Portrait',queues.portrait],['Story',queues.story]].map(([name,q])=>el('span',`${name}: ${q.queued} aguardando · ${q.running} processando`)),el('span',`Entradas agendadas: ${queues.entryScheduled}`));
 $('recent-activity').replaceChildren(...(data.activity.length?data.activity.map(item=>{const li=el('li');li.append(el('time',time(item.at)),el('span',`${item.name?item.name+' · ':''}${item.action||item.label}`));if(item.code)li.append(el('p',`${item.status?item.status+' · ':''}${item.code}`));if(item.admin)li.append(el('p','Administrador: '+item.admin));return li;}):[el('li','Nenhum evento nesta execução.')]));
 $('refresh-status').textContent='Atualizado às '+time(data.at);
}
function drawDetail(p){$('participant-detail-title').textContent=p.name;const body=$('participant-detail-body'),fragment=document.createDocumentFragment(),details=el('dl',undefined,'detail-grid');
 for(const [label,value]of [['UUID',p.uuid.slice(0,8)],['Passe',p.passNumber||'—'],['Status operacional',p.status],['experienceStatus',p.experienceStatus],['avatarStatus',p.avatarStatus],['portraitStatus',p.portraitStatus],['SELFIE TEMPORÁRIA',selfie(p.selfieStatus)],['Story',p.storyStatus],['Bloco',WORLD.blocks[p.currentBlock]?.name||p.currentBlock],['Área',location(p)],['Check-in',date(p.checkinAt)],['Aprovação',date(p.approvedAt)],['Entrada agendada',date(p.scheduledEntryAt)],['Entrada concluída',date(p.enteredAt)],['Tentativas LPC',String(p.avatarAttempts)],['Tentativas portrait',String(p.portraitAttempts)]]){const cell=el('div');cell.append(el('dt',label),el('dd',value));details.append(cell);}fragment.append(details);
 if(p.selfieStatus==='DELETED')fragment.append(el('p','Selfie original removida. Uma nova foto é necessária para reprocessar o avatar ou gerar outro portrait. O Story pode ser regenerado com os assets existentes.','detail-warning'));
 if(p.cleanupWaiting||p.selfieStatus==='DELETE_FAILED')fragment.append(el('p',p.selfieStatus==='DELETE_FAILED'?'DELETE_FAILED · Falha na remoção da selfie temporária.':'Selfie aguardando cleanup.','detail-warning'));
 fragment.append(el('p',p.lastError?`Último erro observado: ${p.lastError.service} · ${p.lastError.status?p.lastError.status+' · ':''}${p.lastError.code} · ${date(p.lastError.at)}`:'Nenhum erro observado nesta execução.','metric-note'));
 const assets=el('div',undefined,'asset-previews');if(p.assets.avatar){const figure=el('figure'),avatar=el('div',undefined,'asset-avatar');avatar.style.backgroundImage=`url("${p.assets.avatar}")`;avatar.setAttribute('role','img');avatar.setAttribute('aria-label','Avatar LPC gerado');figure.append(avatar,el('figcaption','AVATAR LPC'));assets.append(figure);}
 for(const [key,label]of [['portrait','PORTRAIT PIXEL ART'],['story','STORY']])if(p.assets[key]){const figure=el('figure'),image=el('img');image.src=p.assets[key];image.alt=label+' de '+p.name;figure.append(image,el('figcaption',label));assets.append(figure);}fragment.append(assets);
 if(p.assets.pass){const pass=el('a','ABRIR PASSE','operation-link');pass.href=p.assets.pass;pass.target='_blank';pass.rel='noopener';fragment.append(pass);}
 const controls=el('div',undefined,'detail-actions');for(const [permission,action,label]of actions){const box=el('div',undefined,'detail-action'),button=el('button',label,confirmations[action]?'destructive':undefined);button.type='button';button.dataset.action=action;button.disabled=!p.actions[permission].allowed||acting;button.addEventListener('click',()=>runAction(p.uuid,action,button));box.append(button);if(p.actions[permission].reason)box.append(el('p',p.actions[permission].reason));controls.append(box);}fragment.append(controls);body.replaceChildren(fragment);
}
async function detail(){if(!selected||acting||$('confirm-action').open)return;const uuid=selected,revision=++detailRevision;try{const data=await authRequest(`/api/admin/participants/${uuid}`);if(selected===uuid&&revision===detailRevision&&!acting&&!$('confirm-action').open)drawDetail(data.participant);}catch(e){notice(e.message);}}
async function openDetail(uuid){selected=uuid;$('participant-detail-title').textContent='Carregando…';$('participant-detail-body').replaceChildren(el('p','Carregando participante…'));if(!$('participant-detail').open)$('participant-detail').showModal();await detail();}
async function refresh(){if(stopped)return;if(acting||$('confirm-action').open){again=true;return;}if(refreshing){again=true;return;}refreshing=true;$('refresh-operations').disabled=true;
 try{const data=await authRequest('/api/admin/operations');if(stopped)return;renderSummary(data);await list();await detail();}catch(e){$('refresh-status').textContent='Dados podem estar desatualizados.';notice(e.message);}finally{refreshing=false;$('refresh-operations').disabled=false;if(again){again=false;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,300);}}}
$('admin-participant-search').addEventListener('input',()=>{clearTimeout(searchTimer);listRevision++;searchTimer=setTimeout(()=>{page=1;list().catch(e=>notice(e.message));},300);});
$('participant-filter').addEventListener('change',()=>{page=1;list().catch(e=>notice(e.message));});
$('previous-page').addEventListener('click',()=>{if(page>1){page--;list().catch(e=>notice(e.message));}});$('next-page').addEventListener('click',()=>{if(page*25<total){page++;list().catch(e=>notice(e.message));}});
$('refresh-operations').addEventListener('click',refresh);$('camera-admin-home').addEventListener('click',event=>runAction('', 'home',event.currentTarget));$('close-detail').addEventListener('click',()=>$('participant-detail').close());$('participant-detail').addEventListener('close',()=>{selected=null;detailRevision++;});
let poll;try{const session=await authSession();if(!session.authenticated)loginRedirect();else{
 if(window.io){socket=window.io({auth:{mode:'admin'}});socket.on('connect',()=>{$('connection-note').textContent='Atualização instantânea conectada.';refresh();});socket.on('disconnect',reason=>{$('connection-note').textContent='Sem atualização instantânea · consulta a cada 5 s.';if(reason==='io server disconnect')loginRedirect();});socket.on('connect_error',error=>{if(error.message==='Autenticação necessária.')loginRedirect();});socket.on('admin:updated',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,250);});}
 await refresh();poll=setInterval(()=>{if(!document.hidden)refresh();},5000);
 }}catch(e){notice(e.message);}
window.addEventListener('pagehide',()=>{stopped=true;clearInterval(poll);clearTimeout(searchTimer);clearTimeout(refreshTimer);socket?.disconnect();});
