const {createHash}=require('node:crypto');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function passConfig(env=process.env){const wait=Number(env.PASS_PORTRAIT_WAIT_MS);return {portraitWaitMs:env.PASS_PORTRAIT_WAIT_MS!==undefined&&Number.isSafeInteger(wait)&&wait>=0&&wait<=60000?wait:15000,edition:env.EVENT_EDITION||'2026',instagramHandle:(env.EVENT_INSTAGRAM_HANDLE||'').replace(/^@/,''),hashtag:env.EVENT_HASHTAG||'',
 role:env.PASS_DEFAULT_ROLE||'',organization:env.PASS_DEFAULT_ORGANIZATION||''};}
function passData(p,config=passConfig()){
 const ready=p.portraitStatus==='READY';
 const entered=['AVATAR_APPROVED','ENTERING','ACTIVE'].includes(p.experienceStatus);
 const avatarReady=p.experienceStatus==='AVATAR_REVIEW'&&['READY','FALLBACK'].includes(p.avatarStatus);
 const wait=Number.isSafeInteger(config.portraitWaitMs)?config.portraitWaitMs:15000;
 const portraitResolved=['READY','FAILED'].includes(p.portraitStatus)||Date.now()-Date.parse(p.portraitRequestedAt||p.checkinAt)>=wait;
 const credentialState=entered?(p.experienceStatus==='AVATAR_APPROVED'?'ENTRY_SCHEDULED':p.experienceStatus):avatarReady&&portraitResolved?'PASS_READY':'ASSETS_PROCESSING';
 return {name:p.name,role:p.role||config.role,organization:p.organization||config.organization,profileTag:p.profileTag||'',highlight:p.highlight||'',
  credentialState,canEnter:credentialState==='PASS_READY'&&p.status!=='INACTIVE',shareAllowed:entered,
  passNumber:p.passNumber,edition:config.edition,instagramHandle:config.instagramHandle,hashtag:config.hashtag,
  portraitStatus:p.portraitStatus,portraitGeneratedAt:p.portraitGeneratedAt,
  portraitUrl:ready?`/generated/participants/${p.uuid}/portrait.png`:null,
  lpcAvatarUrl:p.avatar,avatarType:p.avatarType,storyStatus:p.storyStatus,
  storyUrl:entered&&p.storyStatus==='READY'?`/generated/participants/${p.uuid}/story.png?v=${p.storyHash}`:null,
  passUrl:`/pass/${p.uuid}`};
}
function storyHash(data){const {storyStatus,storyUrl,passUrl,credentialState,canEnter,shareAllowed,...stable}=data;
 if(stable.portraitStatus==='PROCESSING')stable.portraitStatus='PENDING';
 return createHash('sha256').update(JSON.stringify(stable)).digest('hex');}
function cardMarkup(d){
 const optional=(value,cls)=>value?`<p class="${cls}">${escape(value)}</p>`:'';
 return `<article class="pass-card" aria-label="Crachá Mundo // Digital de ${escape(d.name)}">
  <header class="pass-header"><div class="pass-brand">Mundo <strong>//</strong><span> Digital</span></div><div class="edition">EDIÇÃO ${escape(d.edition)}</div></header>
  <div class="card-meta"><span class="access-badge">PASSE DIGITAL</span><span>CRIE. EXPLORE. CONECTE.</span></div>
  <div class="card-body"><div class="portrait-wrap">${d.portraitUrl?`<img class="portrait" src="${escape(d.portraitUrl)}" alt="Portrait pixel art de ${escape(d.name)}">`:
   `<div class="portrait portrait-placeholder"><span aria-hidden="true">✦</span><p>${d.portraitStatus==='FAILED'?'Seu passe está aqui. O portrait ainda não ficou pronto.':'Preparando seu portrait…'}</p></div>`}</div>
  <div class="pass-person"><span class="person-caption">EU FAÇO PARTE DESTE MUNDO</span><h1>${escape(d.name)}</h1>${optional(d.role,'person-role')}${optional(d.organization,'person-organization')}${optional(d.profileTag,'profile-tag')}${optional(d.highlight,'highlight')}</div>
  <div class="lpc-wrap"><div class="lpc-figure" style="background-image:url('${escape(d.lpcAvatarUrl)}');${d.avatarType==='lpc'?'':'background-size:contain;background-position:center;background-repeat:no-repeat'}" role="img" aria-label="Seu personagem no Mundo // Digital"></div><span>MEU AVATAR NO MUNDO</span></div></div>
  <footer class="card-footer"><div><span class="pass-number-label">NÚMERO OFICIAL DO PASSE</span><strong>${escape(d.passNumber)}</strong></div><div class="social-line">${optional(d.instagramHandle?'@'+d.instagramHandle:'','school-handle')}${optional(d.hashtag,'event-hashtag')}</div></footer>
 </article>`;
}
function storyHtml(data,css){return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${css}</style><body class="story-page"><main class="story-design"><div class="story-kicker">UMA EXPERIÊNCIA. MUITAS POSSIBILIDADES.</div>${cardMarkup(data)}<div class="story-bottom">MEU MUNDO É FEITO DE NOVAS IDEIAS.</div></main></body></html>`;}
module.exports={passConfig,passData,storyHash,cardMarkup,storyHtml,escape};
