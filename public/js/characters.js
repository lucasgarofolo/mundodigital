import { project } from './world.js';
import { createWalker, updateWalker, chooseDestination } from './movement.js';
import { createAvatar as createLpcAvatar, updateLpcAvatar } from './avatar/avatarLpc.js';
import {createVisitController} from './macroNavigation.js';
import {sampleVisualVisit} from './visitVisualBehavior.js';
import {VisitVisualEffects} from './visitVisualEffects.js';
import {sampleVisibleSocial} from './socialBehavior.js';

export const FICTIONAL_PARTICIPANTS = [
  { id:'ana', name:'Ana', color:0xe98277, skin:0xe8b68f },
  { id:'lucas', name:'Lucas', color:0x72bdd3, skin:0xc78c63 },
  { id:'bia', name:'Bia', color:0xd9b869, skin:0x8d593e },
  { id:'pedro', name:'Pedro', color:0x9e97db, skin:0xf1caa4 },
  { id:'julia', name:'Júlia', color:0x9dca87, skin:0xc78c63 },
  { id:'rafa', name:'Rafa', color:0xe2a3bc, skin:0x8d593e },
  { id:'caio', name:'Caio', color:0x72b7a0, skin:0xe8b68f },
  { id:'lara', name:'Lara', color:0xe7a56b, skin:0xf1caa4 },
];

function createAvatarTexture(scene, participant) {
  const key = `avatar-${participant.id}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({x:0,y:0},false);
  g.fillStyle(0x172e36); g.fillRect(5,24,4,6); g.fillRect(12,24,4,6);
  g.fillStyle(participant.color ?? 0x72bdd3); g.fillRect(4,13,13,12);
  g.fillStyle(participant.skin ?? 0xe8b68f); g.fillRect(5,3,11,10); g.fillRect(1,15,3,8); g.fillRect(17,15,3,8);
  g.fillStyle(0x443d3c); g.fillRect(4,1,13,5); g.fillRect(4,5,3,4);
  g.fillStyle(0x263a40); g.fillRect(12,7,2,2);
  g.fillStyle(0xe9e4d0); g.fillRect(9,14,2,5);
  g.generateTexture(key,21,31); g.destroy();
  return key;
}

export class CharacterManager {
  constructor(scene) {
    this.scene=scene;this.participants=[];this.participantsById=new Map();this.visitController=createVisitController();
    this.visualEffects=new VisitVisualEffects(scene);
    scene.events.once('shutdown',()=>{this.visualEffects.clear();this.visitController.clear();});
  }
  addParticipant(data,{authoritative=false,highlight=false}={}) {
    const id=data.uuid||data.id;
    if(!id||!data.name)throw new Error('Participante precisa de id único e nome.');
    if(this.participantsById.has(id))return this.participantsById.get(id);
    data={...data,id};
    const character=createWalker(data,this.participants.length,{visitController:this.visitController});
    // Public snapshots have no simulation node. Their authoritative position is exact.
    if(authoritative&&Number.isFinite(data.position?.x)&&Number.isFinite(data.position?.y)){
      character.position={...data.position};character.state=data.state||character.state;
      character.currentArea=data.currentArea||character.currentArea;character.currentRoom=data.currentRoom||character.currentRoom;
    }
    character.authoritative=authoritative;
    if(authoritative)character.visualVisit=data.visualVisit?{...data.visualVisit}:null;
    if(authoritative)character.socialInteraction=data.socialInteraction?{...data.socialInteraction}:null;
    const shadow=this.scene.add.ellipse(0,0,36,14,0x243f3a,.35);
    character.avatarType=data.avatarType;
    const avatar=data.avatarType==='lpc' ? createLpcAvatar(this.scene,data.avatar) : this.scene.add.image(0,-2,data.avatar??createAvatarTexture(this.scene,data)).setOrigin(.5,1).setDisplaySize(50.4,74.4);
    character.avatarSource=data.avatar;
    const label=this.scene.add.text(0,-82,data.name.split(' ')[0],{
      fontFamily:'monospace',fontSize:'11px',color:'#f3f1df',stroke:'#243b42',strokeThickness:3,
    }).setOrigin(.5,1);
    character.visual=this.scene.add.container(0,0,[shadow,avatar,label]);character.avatar=avatar;
    if(highlight){
      const welcome=this.scene.add.text(0,-101,`${data.name.split(' ')[0]} chegou!`,{fontFamily:'monospace',fontSize:'12px',color:'#bce6bf',stroke:'#243b42',strokeThickness:3}).setOrigin(.5,1);
      character.visual.add(welcome);
      character.welcomeTimer=this.scene.time.delayedCall(3000,()=>{if(welcome.scene)welcome.destroy();});
    }
    this.participants.push(character);this.participantsById.set(id,character);this.syncVisual(character);
    document.getElementById('participant-count').textContent=`Participantes: ${this.participants.length}`;
    return character;
  }
  chooseDestination(character){chooseDestination(character);}
  setParticipantAvatar(id,{avatar,avatarType}) {
    const p=this.participantsById.get(id);if(!p||p.avatarSource===avatar)return;
    const previous=p.avatar;
    const replacement=avatarType==='lpc'?createLpcAvatar(this.scene,avatar,previous.lpcDirection||'down'):
      this.scene.add.image(0,-2,avatar).setOrigin(.5,1).setDisplaySize(50.4,74.4);
    p.visual.remove(previous,true);p.visual.addAt(replacement,1);
    p.avatar=replacement;p.avatarType=avatarType;p.avatarSource=avatar;
    this.syncVisual(p);
  }
  removeParticipant(id) {
    const p=this.participantsById.get(id);if(!p)return;
    for(const other of this.participants)if(other.socialInteraction?.targetUuid===id){
      if(other.authoritative)other.socialInteraction=null;else this.visitController.social.cancel(other);
      this.visualEffects.remove(other.id);
    }
    this.visualEffects.remove(id);p.welcomeTimer?.remove(false);p.visual.destroy();this.participantsById.delete(id);
    this.visitController.release(p);
    this.participants=this.participants.filter(character=>character.id!==id);
    document.getElementById('participant-count').textContent=`Participantes: ${this.participants.length}`;
  }
  syncVisual(character) {
    const screen=project(character.x,character.y);
    character.visual.setPosition(screen.x,screen.y).setDepth(screen.y);
    character.avatar.y=-2+(character.avatarType!=='lpc'&&['WALKING','ENTERING'].includes(character.state)?Math.round(Math.sin(character.elapsed*13)):0);
  }
  syncParticipant(data) {
    const p=this.participantsById.get(data.uuid||data.id);
    if(!p)return;
    p.targetPosition={...data.position};p.state=data.state;p.currentFloor=data.currentFloor;
    p.facing=data.facing||null;
    p.visualVisit=data.visualVisit?{...data.visualVisit}:null;
    p.socialInteraction=data.socialInteraction?{...data.socialInteraction}:null;
    if(data.currentBlock&&p.currentBlock!==data.currentBlock)p.position={...data.position};
    p.currentRoom=data.currentRoom;p.currentBlock=data.currentBlock||p.currentBlock;p.currentArea=data.currentArea||p.currentArea;p.cycleId=data.cycleId;
    if(data.status)p.status=data.status;
    if(data.avatarStatus)p.avatarStatus=data.avatarStatus;
    if(data.avatarVersion!==undefined)p.avatarVersion=data.avatarVersion;
  }
  update(delta) {
    for(const p of this.participants) {
      const before={...p.position};
      if(p.authoritative) {
        p.elapsed+=Math.min(delta/1000,.1);
        if(p.targetPosition) {
          const alpha=1-Math.exp(-Math.min(delta,100)/60);
          p.position.x+=(p.targetPosition.x-p.x)*alpha;p.position.y+=(p.targetPosition.y-p.y)*alpha;
        }
      } else updateWalker(p,delta,this.visitController);
      if(p.authoritative&&p.visualVisit)p.visualVisit.elapsedMs+=Math.min(delta,100);
      if(p.authoritative&&p.socialInteraction)p.socialInteraction.elapsedMs+=Math.min(delta,100);
      const visit=p.state==='VISITING'?sampleVisualVisit(p.visualVisit):null;
      const social=sampleVisibleSocial(p,this.participantsById);
      const dx=p.x-before.x,dy=p.y-before.y;
      if(p.avatarType==='lpc') {
        const facing=social.facing||visit?.facing||p.facing;
        if(p.state==='VISITING'&&['up','left','down','right'].includes(facing))p.avatar.lpcDirection=facing;
        const screenDelta=project(dx,dy);updateLpcAvatar(p.avatar,screenDelta.x,screenDelta.y,p.state);
      }
      else if(Math.abs(dx)+Math.abs(dy)>.0001)p.avatar.setFlipX(project(dx,dy).x<0);
      this.syncVisual(p);
    }
    this.visualEffects.update(this.participants);
  }
}
