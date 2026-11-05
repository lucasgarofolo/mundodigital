import { WORLD, project } from './world.js';
import {HOME_CAMERA,FOCUS_CAMERA} from './cameraConfig.js';
import {VISUAL_BEHAVIOR} from './visitVisualBehavior.js';

// Zoom is relative to the responsive default view, not to a fixed pixel size.
export const CAMERA_SETTINGS = { minZoom:.65, maxZoom:1.8, defaultZoom:1, step:.1, smoothingMs:110 };

export class CameraController {
  constructor(scene) {
    this.scene=scene;
    this.camera=scene.cameras.main;
    this.zoom=CAMERA_SETTINGS.defaultZoom;
    this.targetZoom=this.zoom;
    this.handledKeyEvents=new WeakSet();
    this.cameraMode='HOME';this.focusedParticipantUuid=null;this.following=false;
    this.revision=-1;this.commandId=-1;this.transition=null;this.pulseElapsed=0;
    this.bounds=scene.manualView?(scene.blockBounds||WORLD.bounds):HOME_CAMERA.bounds;
    const b=this.bounds;
    this.defaultFocus={x:b.x+b.width/2,y:b.y+b.height/2};
    this.focus={...this.defaultFocus};
    this.targetFocus={...this.focus};
    this.camera.roundPixels=true;
    this.focusMarker=scene.add.ellipse(0,0,54,24,0x9ce6bc,.12).setStrokeStyle(2,0xb8f4c8).setVisible(false);
    this.focusLabel=scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'14px',fontStyle:'bold',color:'#e1ffe9',
      stroke:'#18362f',strokeThickness:4,align:'center'}).setOrigin(.5,1).setVisible(false);
    this.caption=document.getElementById('camera-caption');this.debug=document.getElementById('camera-debug');
    this.resize(scene.scale.gameSize);
    scene.scale.on('resize',this.resize,this);
    scene.input.on('wheel',this.onWheel,this);
    scene.input.keyboard.on('keydown',this.onKeyDown,this);
    scene.events.once('shutdown',this.destroy,this);
  }

  setZoom(value) {
    if (!Number.isFinite(value)) return;
    this.targetZoom=Phaser.Math.Clamp(value,CAMERA_SETTINGS.minZoom,CAMERA_SETTINGS.maxZoom);
  }
  zoomIn() { this.setZoom(this.targetZoom+CAMERA_SETTINGS.step); }
  zoomOut() { this.setZoom(this.targetZoom-CAMERA_SETTINGS.step); }
  setBlockBounds(bounds,{preserveView=false}={}) {
    const actualZoom=this.baseZoom*this.zoom;
    this.bounds=bounds;
    this.defaultFocus={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    if(!preserveView){this.focus={...this.defaultFocus};this.targetFocus={...this.defaultFocus};}
    this.resize(this.scene.scale.gameSize);
    if(preserveView){this.zoom=actualZoom/this.baseZoom;this.applyView();}
  }
  resetView() {
    // The local shortcut only resets focus zoom while following. It cannot issue HOME.
    if(this.cameraMode==='FOCUS_PARTICIPANT'){this.setZoom(FOCUS_CAMERA.zoom);return;}
    this.targetFocus={...this.defaultFocus};
    this.setZoom(CAMERA_SETTINGS.defaultZoom);
  }

  // One-shot focus in logical world coordinates. No participant search or follow loop.
  focusOn(x,y,{zoom=this.targetZoom}={}) {
    if(this.cameraMode==='FOCUS_PARTICIPANT')return;
    if (!Number.isFinite(x)||!Number.isFinite(y)) return;
    this.targetFocus=project(x,y);
    this.setZoom(zoom);
  }

  applyState(state){
    if(!state||!['HOME','FOCUS_PARTICIPANT'].includes(state.cameraMode)||!Number.isFinite(state.revision))return;
    if(state.instanceId!==this.instanceId){this.instanceId=state.instanceId;this.revision=-1;this.commandId=-1;}
    if(state.revision<this.revision)return;
    const commandChanged=this.commandId!==state.commandId;
    this.revision=state.revision;this.commandId=state.commandId;this.operationalState=state;
    if(commandChanged){
      // Explicit block URLs/demo remain useful development previews until the first operator command.
      if(state.cameraMode==='HOME'){
        if(!(state.commandId===0&&this.scene.manualView))this.goHome();
      }else this.focusOnParticipant(state.focusedParticipantUuid);
    }
    if(state.cameraMode==='FOCUS_PARTICIPANT'&&!state.available)this.stopFollowing();
    const selector=document.getElementById('block-selector');
    if(selector)selector.disabled=this.cameraMode==='FOCUS_PARTICIPANT';
    this.updateCaption();
  }
  startTransition(){
    this.transition={from:{...this.focus},zoom:this.zoom,elapsed:0,duration:FOCUS_CAMERA.transitionMs};
  }
  focusOnParticipant(uuid){
    if(typeof uuid!=='string'||!uuid)return;
    this.stopFollowing();this.cameraMode='FOCUS_PARTICIPANT';this.focusedParticipantUuid=uuid;
    this.following=true;this.needsFocusTransition=true;this.setZoom(FOCUS_CAMERA.zoom);
    if(!this.scene.participantsClient?.latest.has(uuid))this.scene.participantsClient?.synchronize();
  }
  followParticipant(uuid){this.focusOnParticipant(uuid);}
  stopFollowing(){
    this.following=false;this.transition=null;this.targetFocus={...this.focus};this.targetZoom=this.zoom;
    if(this.hiddenLabel?.scene)this.hiddenLabel.setVisible(true);
    this.hiddenLabel=null;this.focusMarker.setVisible(false);this.focusLabel.setVisible(false);
  }
  transitionToBlock(blockId){
    if(blockId===this.scene.currentBlock)return;
    this.scene.setBlock(blockId,{cameraDriven:true,preserveCamera:true});
    this.camera.fadeIn(FOCUS_CAMERA.blockFadeMs,16,31,41);
  }
  goHome(){
    this.stopFollowing();this.cameraMode='HOME';this.focusedParticipantUuid=null;
    this.transitionToBlock(HOME_CAMERA.blockId);
    this.setBlockBounds(HOME_CAMERA.bounds,{preserveView:true});
    this.targetFocus={...HOME_CAMERA.center};this.setZoom(HOME_CAMERA.zoom);this.startTransition();
    this.updateCaption();
  }
  updateCaption(){
    if(!this.caption)return;
    this.caption.hidden=this.cameraMode!=='FOCUS_PARTICIPANT';
    const state=this.operationalState,p=state?.participant;
    this.caption.textContent=state?.available===false?'Participante não está mais disponível no mundo.':
      p?`${p.name} · ${WORLD.blocks[p.currentBlock]?.name||p.currentBlock} · ${WORLD.blocks[p.currentBlock]?.areas[p.currentArea]?.name||p.currentArea}`:'Localizando participante…';
  }
  updateTracking(delta){
    this.pulseElapsed+=Math.min(delta,100);
    if(this.cameraMode!=='FOCUS_PARTICIPANT'||!this.following)return;
    const data=this.scene.participantsClient?.latest.get(this.focusedParticipantUuid);
    if(!data||!WORLD.blocks[data.currentBlock]||!Number.isFinite(data.position?.x)||!Number.isFinite(data.position?.y))return;
    const blockChanged=data.currentBlock!==this.scene.currentBlock;
    if(blockChanged)this.transitionToBlock(data.currentBlock);
    const p=this.scene.characters.participantsById.get(this.focusedParticipantUuid);
    const point=project(p?.x??data.position.x,p?.y??data.position.y);
    this.targetFocus={x:point.x,y:point.y-FOCUS_CAMERA.headroom};
    if(this.needsFocusTransition||blockChanged){this.startTransition();this.needsFocusTransition=false;}
    this.focusMarker.setVisible(!!p).setPosition(point.x,point.y).setDepth((p?.visual.depth||point.y)-.5)
      .setScale(1+Math.sin(this.pulseElapsed/320)*.09).setAlpha(.7+Math.sin(this.pulseElapsed/320)*.2);
    this.focusLabel.setVisible(!!p).setPosition(point.x,point.y-104)
      .setDepth(Math.max(VISUAL_BEHAVIOR.trackingNameDepth,(p?.visual.depth||point.y)+2));
    if(p){
      this.focusLabel.setText(p.name);
      const label=p.visual.list[2];
      if(this.hiddenLabel!==label){if(this.hiddenLabel?.scene)this.hiddenLabel.setVisible(true);this.hiddenLabel=label;}
      label.setVisible(false);
    }
  }

  onWheel(_pointer,_objects,_deltaX,deltaY) {
    if (!Number.isFinite(deltaY)||deltaY===0) return;
    this.setZoom(this.targetZoom-Math.sign(deltaY)*CAMERA_SETTINGS.step);
  }
  onKeyDown(event) {
    // Preserve browser shortcuts and future text fields.
    if(event.ctrlKey||event.metaKey||event.altKey||event.target?.matches?.('input,textarea,select,[contenteditable]')) return;
    // Phaser can emit a queued native event again when inputs arrive in one frame.
    // Genuine key-repeat events are new objects and continue to work normally.
    if(this.handledKeyEvents.has(event)) return;
    this.handledKeyEvents.add(event);
    if(event.key==='+'||event.code==='NumpadAdd') {event.preventDefault();this.zoomIn();}
    else if(event.key==='-'||event.code==='NumpadSubtract') {event.preventDefault();this.zoomOut();}
    else if(event.key==='0'||event.code==='Numpad0') {event.preventDefault();this.resetView();}
  }

  resize({width,height}) {
    const b=this.bounds;
    // Same responsive framing as Phase 1.5. Keep both current and target zoom.
    this.baseZoom=Math.max(.001,Math.min(Math.max(1,width-40)/b.width,Math.max(1,height-150)/b.height));
    this.camera.setViewport(0,0,width,height);
    this.applyView();
  }
  applyView() {
    this.camera.setZoom(this.baseZoom*this.zoom);
    this.camera.centerOn(this.focus.x,this.focus.y);
  }
  update(delta) {
    this.updateTracking(delta);
    // Frame-rate independent interpolation; repeated input only updates the target.
    const alpha=1-Math.exp(-Math.min(delta,100)/(this.following?FOCUS_CAMERA.followSmoothingMs:CAMERA_SETTINGS.smoothingMs));
    const approach=(current,target)=>Math.abs(target-current)<.0001 ? target : current+(target-current)*alpha;
    if(this.transition){
      const t=this.transition;t.elapsed+=Math.min(delta,100);
      const progress=Math.min(1,t.elapsed/t.duration),ease=progress<.5?4*progress**3:1-(-2*progress+2)**3/2;
      this.zoom=t.zoom+(this.targetZoom-t.zoom)*ease;
      this.focus.x=t.from.x+(this.targetFocus.x-t.from.x)*ease;
      this.focus.y=t.from.y+(this.targetFocus.y-t.from.y)*ease;
      if(progress===1)this.transition=null;
    }else{
      this.zoom=approach(this.zoom,this.targetZoom);
      this.focus.x=approach(this.focus.x,this.targetFocus.x);
      this.focus.y=approach(this.focus.y,this.targetFocus.y);
    }
    this.applyView();
    if(this.debug&&this.scene.debugWorld){
      this.debug.hidden=false;
      const p=this.scene.participantsClient?.latest.get(this.focusedParticipantUuid);
      this.debug.textContent=`Camera: ${this.cameraMode}\nTarget: ${this.focusedParticipantUuid||'—'}\nBlock: ${this.scene.currentBlock}\nArea: ${p?.currentArea||HOME_CAMERA.areaId}`;
    }
  }
  destroy() {
    this.stopFollowing();this.focusMarker.destroy();this.focusLabel.destroy();
    this.scene.scale.off('resize',this.resize,this);
    this.scene.input.off('wheel',this.onWheel,this);
    this.scene.input.keyboard.off('keydown',this.onKeyDown,this);
  }
}
