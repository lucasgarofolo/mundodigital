import {updateVisitDebug,drawBlock} from './macroWorldRenderer.js';

import {loginRedirect} from './auth.js';
export class ParticipantsClient {
  constructor(scene) {
    this.scene=scene;this.pending=new Map();this.latest=new Map();this.active=true;this.textureLoads=new Map();
    this.status=document.getElementById('world-status');this.buffer=[];this.syncing=false;this.retryTimer=null;
    // HTTP restoration must also work if the Socket.IO client script cannot load.
    this.socket=window.io?window.io({auth:{mode:'live',debugWorld:scene.debugWorld}}):{connected:false,on(){},emit(){},disconnect(){}};
    this.socket.on('connect',()=>{this.status.textContent='SINCRONIZANDO O MUNDO…';this.synchronize();});
    this.socket.on('disconnect',reason=>{if(reason==='io server disconnect')loginRedirect();this.status.textContent='RECONECTANDO AO MUNDO…';});
    this.socket.on('connect_error',error=>{if(error.message==='Autenticação necessária.')loginRedirect();this.status.textContent='SEM CONEXÃO · TENTANDO NOVAMENTE…';});
    this.socket.on('participant:joined',data=>this.event('joined',data));
    this.socket.on('camera:state',state=>this.setCameraState(state));
    this.socket.on('world:visits',snapshot=>this.setVisitDebug(snapshot));
    this.socket.on('participant:enter',data=>this.event('joined',data));
    this.socket.on('participant:avatar-updated',data=>this.event('avatar',data));
    this.socket.on('participants:cleared',()=>this.event('cleared',{}));
    this.socket.on('participant:removed',data=>this.event('removed',data));
    this.socket.on('participants:moved',event=>event.participants.forEach(data=>this.event('moved',data)));
    // Initial recovery is HTTP, including when Socket.IO is unavailable.
    this.synchronize();
    scene.events.once('shutdown',()=>{
      this.active=false;clearTimeout(this.retryTimer);this.controller?.abort();this.socket.disconnect();
    });
  }
  label() {
    this.status.textContent=this.socket.connected
      ?(this.provisional?'AO VIVO · AVATARES PROVISÓRIOS':'AO VIVO · Mundo // Digital')
      :'MUNDO RESTAURADO · RECONECTANDO…';
  }
  async synchronize() {
    if(!this.active)return;
    if(this.syncing){this.resyncRequested=true;return;}
    this.syncing=true;clearTimeout(this.retryTimer);this.buffer=[];
    const requestedInstance=this.cameraState?.instanceId;
    this.controller=new AbortController();
    const timeout=setTimeout(()=>this.controller.abort(),10000);
    try {
      const response=await fetch(this.scene.debugWorld?'/api/world?debugWorld=true':'/api/world',{cache:'no-store',signal:this.controller.signal});
      if(response.status===401){this.active=false;loginRedirect();return;}
      if(!response.ok)throw new Error('Não foi possível recuperar o mundo.');
      const snapshot=await response.json();if(!this.active)return;
      if(snapshot.camera&&this.cameraState?.instanceId!==requestedInstance&&snapshot.camera.instanceId!==this.cameraState?.instanceId){this.resyncRequested=true;return;}
      this.provisional=snapshot.provisional;
      if(this.scene.debugWorld&&snapshot.debugWorldEnabled===false){
        this.scene.debugWorld=false;this.visitDebug=null;drawBlock(this.scene,this.scene.currentBlock);
      }
      const ids=new Set(snapshot.participants.map(p=>p.uuid||p.id));
      for(const id of this.latest.keys())if(!ids.has(id))this.latest.delete(id);
      for(const p of [...this.scene.characters.participants])if(!ids.has(p.id))this.scene.characters.removeParticipant(p.id);
      snapshot.participants.forEach(data=>this.receive(data,true));
      if(snapshot.visits)this.setVisitDebug(snapshot.visits);
      // Events arriving while HTTP was in flight are replayed after the snapshot.
      for(const [type,data] of this.buffer)this.applyEvent(type,data);
      if(snapshot.camera)this.setCameraState(snapshot.camera);
      this.label();
    } catch {
      if(this.active){this.status.textContent='SEM SINCRONIZAÇÃO · TENTANDO NOVAMENTE…';this.retryTimer=setTimeout(()=>this.synchronize(),2000);}
    } finally {
      clearTimeout(timeout);this.syncing=false;
      if(this.resyncRequested&&this.active){this.resyncRequested=false;this.synchronize();}
    }
  }
  event(type,data) {
    if(this.syncing){this.buffer.push([type,data]);return;}
    this.applyEvent(type,data);
  }
  applyEvent(type,data) {
    if(type==='removed'){const id=data.uuid||data.id;this.latest.delete(id);this.scene.characters.removeParticipant(id);return;}
    if(type==='cleared'){
      this.latest.clear();
      for(const p of [...this.scene.characters.participants])this.scene.characters.removeParticipant(p.id);
      this.synchronize();return;
    }
    const id=data.uuid||data.id;
    if(type==='joined'){this.receive(data);return;}
    const previous=this.latest.get(id);
    if(previous)this.receive({...previous,...data});
    else this.synchronize(); // A missed join is repaired by the API, never invented locally.
  }
  receive(data,snap=false) {
    if(!['ENTERING','ACTIVE'].includes(data.status)){
      const id=data.uuid||data.id;this.latest.delete(id);this.scene.characters.removeParticipant(id);return;
    }
    const id=data.uuid||data.id;data={...data,id,uuid:id};this.latest.set(id,data);
    const existing=this.scene.characters.participantsById.get(id);
    if(!this.isVisible(data)){
      if(existing)this.scene.characters.removeParticipant(id);
      return;
    }
    if(existing){
      if(snap){existing.position={...data.position};this.scene.characters.syncVisual(existing);}
      this.scene.characters.syncParticipant(data);this.socket.emit('participant:displayed',id);
      if(existing.avatarSource===this.textureKey(data))return;
    }
    if(this.pending.has(id))return;
    const task=this.add(data).catch(()=>{
      if(this.active){this.status.textContent='RECARREGANDO AVATAR…';clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.synchronize(),2000);}
    }).finally(()=>this.pending.delete(id));
    this.pending.set(id,task);
  }
  async add(data) {
    while(this.active){
      const current=this.latest.get(data.id);if(!current||!this.isVisible(current))return;
      const key=this.textureKey(current);
      try{await this.loadTexture(key,current);}catch{
        // Retain an existing avatar; an initial load failure gets the offline LPC.
        if(this.scene.characters.participantsById.has(data.id))throw new Error('Avatar load failed');
        const fallbackKey='lpc-emergency-fallback';
        await this.loadTexture(fallbackKey,{avatarType:'lpc',avatarUrl:'/assets/avatars/lpc/test-avatar.png'});
        if(this.active&&this.latest.has(data.id)&&this.isVisible(this.latest.get(data.id)))this.scene.characters.addParticipant({...this.latest.get(data.id),avatar:fallbackKey,avatarType:'lpc'},{authoritative:true});
        throw new Error('Using local fallback');
      }
      const latest=this.latest.get(data.id);if(!this.active||!latest||!this.isVisible(latest))return;
      // A READY event can arrive while the provisional PNG is loading.
      if(this.textureKey(latest)!==key)continue;
      if(this.scene.characters.participantsById.has(data.id))this.scene.characters.setParticipantAvatar(data.id,{avatar:key,avatarType:latest.avatarType});
      else this.scene.characters.addParticipant({...latest,avatar:key},{authoritative:true,highlight:latest.status==='ENTERING'});
      this.socket.emit('participant:displayed',data.id);return;
    }
  }
  textureKey(data){return `participant-${data.uuid||data.id}-${data.avatarVersion||'legacy'}`;}
  setVisitDebug(snapshot){if(this.scene.debugWorld){this.visitDebug=snapshot;updateVisitDebug(this.scene,snapshot);}}
  setCameraState(state){
    if(!state||!Number.isFinite(state.revision)||(this.cameraState&&this.cameraState.instanceId===state.instanceId&&state.revision<this.cameraState.revision))return;
    this.cameraState=state;this.scene.cameraController?.applyState(state);
  }
  isVisible(data){return (data.currentBlock||'blockB_upper')===this.scene.currentBlock;}
  showBlock(){
    for(const p of [...this.scene.characters.participants])if(!this.isVisible(p))this.scene.characters.removeParticipant(p.id);
    for(const data of this.latest.values())this.receive(data,true);
    if(this.visitDebug)updateVisitDebug(this.scene,this.visitDebug);
  }
  async loadTexture(key,data){
    if(this.scene.textures.exists(key))return;
    if(this.textureLoads.has(key))return this.textureLoads.get(key);
    const task=(async()=>{
      const image=new Image();
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{image.onload=null;image.onerror=null;reject(new Error('Avatar timeout'));},10000);
        image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('Avatar unavailable'));};
        image.src=data.avatarUrl||data.avatar;
      });
      if(!this.active||this.scene.textures.exists(key))return;
      if(data.avatarType==='lpc'){
        if(image.naturalWidth!==576||image.naturalHeight!==256)throw new Error('Invalid sprite layout');
        this.scene.textures.addSpriteSheet(key,image,{frameWidth:64,frameHeight:64});
      }else this.scene.textures.addImage(key,image);
    })();
    this.textureLoads.set(key,task);
    try{await task;}finally{this.textureLoads.delete(key);}
  }
}
