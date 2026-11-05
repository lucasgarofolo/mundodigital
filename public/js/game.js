import { WORLD } from './world.js';
import {drawBlock} from './macroWorldRenderer.js';
import {INITIAL_BLOCK} from './macroWorldConfig.js';
import { CharacterManager, FICTIONAL_PARTICIPANTS } from './characters.js';
import { CameraController } from './cameraController.js';
import { ParticipantsClient } from './participantsClient.js';
import { preloadLpc } from './avatar/avatarLpc.js';

export class WorldScene extends Phaser.Scene {
  constructor() { super('WorldScene'); }
  preload() {
    this.lpcTest=new URLSearchParams(window.location.search).get('lpcTest')==='true';
    if(this.lpcTest) preloadLpc(this);
  }
  create() {
    const params=new URLSearchParams(window.location.search);
    this.debugWorld=params.get('debugWorld')==='true';
    this.manualView=params.has('block')||this.debugWorld||this.lpcTest||params.get('demo')==='1';
    this.currentBlock=WORLD.blocks[params.get('block')]?params.get('block'):INITIAL_BLOCK;
    drawBlock(this,this.currentBlock,{debug:this.debugWorld});
    this.characters = new CharacterManager(this);
    this.demo=this.lpcTest||new URLSearchParams(window.location.search).get('demo')==='1';
    document.getElementById('participant-count').textContent='Participantes: 0';
    if(this.demo) {
      this.populateDemo();
      document.getElementById('world-status').textContent='DEMONSTRAÇÃO · AVATARES FICTÍCIOS';
    } else this.participantsClient=new ParticipantsClient(this);
    if(this.lpcTest) {
      const status=document.getElementById('world-status');
      status.textContent='DEMONSTRAÇÃO · UNIVERSAL LPC · ';
      const credits=document.createElement('a');credits.href='/assets/avatars/lpc/CREDITS-LPC.md';
      credits.textContent='CRÉDITOS';credits.style.color='inherit';status.appendChild(credits);
    }
    this.cameraController=new CameraController(this);
    if(this.participantsClient?.cameraState)this.cameraController.applyState(this.participantsClient.cameraState);
    const selector=document.getElementById('block-selector');
    selector.replaceChildren(...Object.values(WORLD.blocks).map(block=>{
      const option=document.createElement('option');option.value=block.id;option.textContent=block.name;return option;
    }));
    selector.value=this.currentBlock;
    document.querySelector('.block-navigation').hidden=!this.manualView;
    const change=()=>this.setBlock(selector.value);
    selector.addEventListener('change',change);
    this.events.once('shutdown',()=>selector.removeEventListener('change',change));
    this.updateBlockLabel();
  }
  updateBlockLabel(){
    const block=WORLD.blocks[this.currentBlock];
    document.querySelector('.room-label').textContent=this.currentBlock===INITIAL_BLOCK?'Sala 5':block.name;
    document.getElementById('floor-label').textContent=block.floor==='lower_floor'?'PAVIMENTO INFERIOR':'PAVIMENTO SUPERIOR';
    document.getElementById('world').setAttribute('aria-label',block.name);
  }
  populateDemo(){
    if(this.currentBlock===INITIAL_BLOCK)FICTIONAL_PARTICIPANTS.forEach((data,index)=>this.addParticipant(this.lpcTest&&index===1?{...data,id:'lpc_test_avatar',name:'LPC',avatarType:'lpc'}:data));
  }
  setBlock(id,{cameraDriven=false,preserveCamera=false}={}){
    if(this.cameraController?.cameraMode==='FOCUS_PARTICIPANT'&&!cameraDriven)return;
    if(!WORLD.blocks[id]||id===this.currentBlock)return;
    this.currentBlock=id;drawBlock(this,id,{debug:this.debugWorld});
    this.cameraController.setBlockBounds(this.blockBounds,{preserveView:preserveCamera});
    this.participantsClient?.showBlock();
    if(this.demo){
      for(const p of [...this.characters.participants])this.characters.removeParticipant(p.id);
      this.populateDemo();
    }
    document.getElementById('block-selector').value=id;this.updateBlockLabel();
    const url=new URL(window.location.href);url.searchParams.set('block',id);history.replaceState(null,'',url);
  }
  addParticipant(data) { return this.characters.addParticipant(data); }
  update(_time,delta) {
    this.characters?.update(delta);
    this.cameraController?.update(delta);
  }
}

export const game = new Phaser.Game({
  type:Phaser.AUTO, parent:'world', backgroundColor:'#101f29',
  pixelArt:true, antialias:false, roundPixels:true,
  scale:{mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight},
  scene:[WorldScene],
});
