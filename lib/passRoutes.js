const path=require('node:path');
const express=require('express');
const {cardMarkup}=require('./passView');
function attachPassRoutes({app,store,passService,authorizeReview,auth}){
 const find=req=>/^[0-9a-f-]{36}$/i.test(req.params.uuid)?store.findByUuid(req.params.uuid):null;
 const available=p=>p?.portraitRequestedAt&&p?.passNumber;
 app.get('/pass/:uuid',(req,res)=>{
  if(!available(find(req))){res.status(404).type('text').send('Passe não encontrado.');return;}
  res.set('Cache-Control','no-store');res.sendFile(path.join(__dirname,'../public/pass.html'));
 });
 app.get('/api/pass/:uuid',(req,res)=>{
  const p=find(req);if(!available(p)){res.status(404).json({error:'Passe não encontrado.'});return;}
  const data=passService.data(p);res.set('Cache-Control','no-store');res.json({pass:{...data,participantStatus:p.status,canRetryPortrait:p.status!=='INACTIVE'&&!!auth.userFor(req)},cardHtml:cardMarkup(data)});
 });
 app.get('/generated/participants/:uuid/:filename',(req,res)=>{
  const p=find(req),file=req.params.filename;
  if(!available(p)||!['portrait.png','story.png'].includes(file)||file==='portrait.png'&&p.portraitStatus!=='READY'||file==='story.png'&&p.storyStatus!=='READY'){
   res.sendStatus(404);return;
  }
  if(file==='story.png'&&!passService.data(p).shareAllowed){res.sendStatus(404);return;}
  if(req.query.download==='1')res.attachment(`mundo-digital-${p.passNumber}-${file}`);
  res.set('Cache-Control',file==='portrait.png'?'public, max-age=86400':'no-cache');
  res.sendFile(file,{root:passService.paths(p.uuid).directory});
 });
 app.post('/api/participants/:uuid/retry-portrait',auth.requireAdmin,authorizeReview,(req,res)=>{
  if(!passService.retry(req.params.uuid)){res.status(409).json({error:'O portrait já está pronto, está em processamento ou atingiu o limite de duas tentativas.'});return;}
  res.json({pass:passService.data(store.findByUuid(req.params.uuid))});
 });
 app.post('/api/participants/:uuid/prepare-pass',authorizeReview,(req,res)=>{
  passService.request(req.params.uuid);res.json({pass:passService.data(store.findByUuid(req.params.uuid))});
 });
 app.put('/api/participants/:uuid/pass-profile',authorizeReview,express.json({limit:'2kb'}),(req,res)=>{
  const fields=['role','organization','profileTag','highlight'];
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(k=>!fields.includes(k))||fields.some(k=>req.body[k]!==undefined&&(typeof req.body[k]!=='string'||req.body[k].length>80||/[\p{Cc}<>]/u.test(req.body[k])))){
   res.status(400).json({error:'Informe somente campos opcionais de texto com até 80 caracteres.'});return;
  }
  const current=store.findByUuid(req.params.uuid);
  if(!available(current)){res.status(409).json({error:'Aguarde a preparação do passe.'});return;}
  const profile=Object.fromEntries(fields.map(k=>[k,req.body[k]===undefined?current[k]:req.body[k].trim()]));
  const updated=store.updatePassProfile(req.params.uuid,profile);passService.refreshStory(req.params.uuid);
  res.json({pass:passService.data(updated)});
 });
}
module.exports={attachPassRoutes};
