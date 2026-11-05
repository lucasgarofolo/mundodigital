const express=require('express');
const {randomBytes}=require('node:crypto');

const fold=value=>String(value).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
// One operational camera shared by the installation. No coordinates come from the operator.
function createOperatorControl({app,io,store,walkers,auth,now=Date.now}){
  const instanceId=randomBytes(12).toString('hex');
  let revision=0,commandId=0,mode='HOME',focused=null,lastParticipant=null,lost=false,lastJSON='';
  const authorized=req=>!!auth.userFor(req)&&auth.originOK(req);
  const resolve=uuid=>{
    const record=store.operatorParticipant(uuid),walker=walkers.get(uuid);
    if(!record)return null;
    const available=record.status!=='INACTIVE'&&['ENTERING','ACTIVE'].includes(record.status)&&!!walker&&
      Number.isFinite(walker.position?.x)&&Number.isFinite(walker.position?.y);
    return {...record,currentBlock:walker?.currentBlock||record.currentBlock,currentArea:walker?.currentArea||record.currentArea,available};
  };
  function state(){
    return {cameraMode:mode,focusedParticipantUuid:focused,participant:lastParticipant?{...lastParticipant}:null,
      available:mode==='FOCUS_PARTICIPANT'&&!lost&&!!lastParticipant?.available,revision,commandId,instanceId};
  }
  function publish(force=false){
    const json=JSON.stringify({mode,focused,lastParticipant,lost,commandId});
    if(!force&&json===lastJSON)return;
    lastJSON=json;revision++;
    io.to('live').to('operators').emit('camera:state',state());
  }
  function refresh(){
    if(!focused)return;
    const participant=resolve(focused);
    if(!participant?.available)lost=true;
    if(participant)lastParticipant=participant;
    publish();
  }
  function focus(uuid){
    if(typeof uuid!=='string'||uuid.length>80)return {ok:false,error:'Participante inválido.'};
    const participant=resolve(uuid);
    if(!participant?.available)return {ok:false,error:'Participante ainda não entrou ou não está mais disponível no mundo.'};
    mode='FOCUS_PARTICIPANT';focused=uuid;lastParticipant=participant;lost=false;commandId++;publish(true);
    return {ok:true,state:state()};
  }
  function home(){
    mode='HOME';focused=null;lastParticipant=null;lost=false;commandId++;publish(true);
    return {ok:true,state:state()};
  }
  const gate=(req,res,next)=>auth.requireAuth(req,res,()=>auth.originOK(req)?next():res.status(403).json({error:'Origem inválida.'}));
  app.get('/api/operator/session',gate,(_req,res)=>res.set('Cache-Control','no-store').json({authorized:true,requiresKey:false,localOnly:false}));
  app.get('/api/participants/search',gate,(req,res)=>{
    const q=typeof req.query.q==='string'?req.query.q.trim():'';
    if(q.length<2||q.length>80){res.json({participants:[]});return;}
    const participants=store.searchParticipants(fold(q),20).map(p=>{
      const walker=walkers.get(p.uuid);
      return {...p,currentBlock:walker?.currentBlock||p.currentBlock,currentArea:walker?.currentArea||p.currentArea,
        available:['ENTERING','ACTIVE'].includes(p.status)&&!!walker};
    });
    res.json({participants});
  });
  app.get('/api/operator/camera',gate,(_req,res)=>{refresh();res.json(state());});
  io.on('connection',socket=>{
    if(socket.handshake.auth.mode!=='operator')return;
    socket.join('operators');refresh();socket.emit('camera:state',state());
    socket.on('camera:focusParticipant',(payload,ack)=>{
      if(!authorized(socket.request)){if(typeof ack==='function')ack({ok:false,error:'Sessão do operador encerrada. Entre novamente.'});return;}
      const result=focus(payload?.participantUuid);
      if(typeof ack==='function')ack(result);
    });
    socket.on('camera:goHome',(_payload,ack)=>{
      if(!authorized(socket.request)){if(typeof ack==='function')ack({ok:false,error:'Sessão do operador encerrada. Entre novamente.'});return;}
      const result=home();if(typeof ack==='function')ack(result);
    });
  });
  return {state,refresh,focus,goHome:home};
}
module.exports={createOperatorControl,fold};
