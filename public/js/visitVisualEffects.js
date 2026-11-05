import {project,box} from './world.js';
import {VISUAL_BEHAVIOR,sampleVisualVisit} from './visitVisualBehavior.js';
import {sampleVisibleSocial} from './socialBehavior.js';

// Local pixel shapes: no fonts, OS emoji, images, particles or permanent timers.
const glyphs={attention:['00100','00100','00100','00000','00100'],
  curious:['01110','10001','00010','00100','00000','00100'],
  thinking:['0000000','0000000','1010101'],sparkle:['00100','00100','11111','00100','00100']};
function drawEmote(g,kind){
  g.clear().fillStyle(0x203c4a).fillRect(-10,-11,20,22);
  g.lineStyle(2,0xc9e7d9).strokeRect(-10,-11,20,22);
  g.fillStyle(kind==='sparkle'?0xf4d888:0xe9f3df);
  const rows=glyphs[kind]||glyphs.attention;
  rows.forEach((row,y)=>[...row].forEach((pixel,x)=>{if(pixel==='1')g.fillRect(x*2-row.length,y*2-rows.length,2,2);}));
}

// Detach only the existing moving part from its static machine drawing.
export function createMachineVisual(scene,area){
  const ids={robot:'robotArmDemo',printer:'printerDemo',cnc:'cncDemo',crane:'craneDemo'};
  if(!ids[area.theme])return;
  const {x,y,width:w,height:h}=area.obstacles[0],g=scene.add.graphics().setDepth(project(x+w,y+h).y+.1);
  const cube=(dx,dy,cw,ch,z,color,base=0)=>box(g,x+dx,y+dy,cw,ch,z,color,base);
  const point=(dx,dy,z)=>{const p=project(x+dx,y+dy);return {x:p.x,y:p.y-z};};
  function draw(progress=null){
    const movement=progress===null?0:Math.sin(progress*Math.PI*2),active=progress!==null;
    g.clear();
    if(area.theme==='robot'){
      const points=[[1.3,.8,45],[1.3,.8,83],[2.2+movement*.15,.8,105+movement*4],[2.6+movement*.22,1.3,78+movement*3]];
      g.lineStyle(9,0xe6af5c).strokePoints(points.map(p=>point(...p)));
      g.fillStyle(0x9cb2ae);for(const p of points.slice(1,3)){const q=point(...p);g.fillCircle(q.x,q.y,6);}
    }else if(area.theme==='printer')cube(1.35+movement*.35,.35,.35,.5,67,0xe0b167,49);
    else if(area.theme==='cnc')cube(2.25,.15,.3,.1,58,active&&Math.sin(progress*Math.PI*6)>0?0xf4d888:0x82d4ad,45);
    else{
      const dx=movement*.22;
      g.lineStyle(4,0x304653).strokePoints([[1.5+dx,.3,124],[1.5+dx,.3,70],[1.8+dx,.3,63],[2+dx,.3,70]].map(p=>point(...p)));
    }
  }
  const entry={animation:ids[area.theme],graphics:g,state:'IDLE',owner:null,
    play(progress,owner){this.state='PLAYING';this.owner=owner;draw(progress);},
    reset(){if(this.state!=='IDLE'){draw();this.state='IDLE';this.owner=null;}}};
  draw();scene.machineVisuals.set(`poi_${area.id}`,entry);
}

export class VisitVisualEffects {
  constructor(scene){this.scene=scene;this.emotes=new Map();}
  remove(id){this.emotes.get(id)?.destroy();this.emotes.delete(id);
    for(const machine of this.scene.machineVisuals?.values()||[])if(machine.owner===id)machine.reset();}
  clear(){for(const id of [...this.emotes.keys()])this.remove(id);
    for(const machine of this.scene.machineVisuals?.values()||[])machine.reset();}
  update(participants){
    const wanted=new Set(),demos=new Map(),placed=[];let nameBoxes=null;
    const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const socialPosition=(p,g)=>{
      // Only active social bubbles need this bounded visual check (at most two per block).
      if(!nameBoxes){
        nameBoxes=participants.map(other=>other.visual.list[2]).filter(label=>label?.visible&&label.scene).map(label=>label.getBounds());
        const focus=this.scene.cameraController?.focusLabel;if(focus?.visible)nameBoxes.push(focus.getBounds());
      }
      const preferred={x:VISUAL_BEHAVIOR.emoteOffsetX,y:VISUAL_BEHAVIOR.emoteOffsetY};
      const offsets=[...(g?.socialOffset?[g.socialOffset]:[]),preferred,{x:-preferred.x,y:preferred.y},
        {x:58,y:-60},{x:-58,y:-60},{x:0,y:-140}];
      for(const offset of offsets){
        const x=Math.round(p.visual.x+offset.x),y=Math.round(p.visual.y+offset.y),bounds={x:x-12,y:y-13,width:24,height:26};
        if(![...nameBoxes,...placed].some(box=>overlaps(bounds,box))){placed.push(bounds);return {x,y,offset};}
      }
      return null; // Facing remains visible if the names leave no safe bubble position.
    };
    for(const p of participants){
      const plan=p.visualVisit;
      if(!VISUAL_BEHAVIOR.enabled||p.state!=='VISITING'||p.status==='INACTIVE'||!plan||plan.blockId!==this.scene.currentBlock)continue;
      const base=sampleVisualVisit(plan),social=sampleVisibleSocial(p,this.scene.characters?.participantsById);
      const sample=social.emote?{...base,emote:social.emote,progress:social.progress}:base;
      if(sample.emote&&(this.emotes.has(p.id)||this.emotes.size<VISUAL_BEHAVIOR.maxActiveEmotes)){
        let g=this.emotes.get(p.id);
        const position=social.emote?socialPosition(p,g):{x:Math.round(p.visual.x+VISUAL_BEHAVIOR.emoteOffsetX),y:Math.round(p.visual.y+VISUAL_BEHAVIOR.emoteOffsetY)};
        if(position){
          wanted.add(p.id);
          if(!g){g=this.scene.add.graphics();drawEmote(g,sample.emote);g.emote=sample.emote;this.emotes.set(p.id,g);}
          if(g.emote!==sample.emote){drawEmote(g,sample.emote);g.emote=sample.emote;}
          g.socialOffset=position.offset;
          g.setPosition(position.x,position.y).setDepth(Math.max(VISUAL_BEHAVIOR.emoteDepth,p.visual.depth+.5))
            .setAlpha(Math.min(1,sample.progress*8,(1-sample.progress)*8));
        }
      }
      if(sample.machineAnimation&&!demos.has(plan.poiId)&&demos.size<VISUAL_BEHAVIOR.maxActiveMachines){
        const machine=this.scene.machineVisuals?.get(plan.poiId);
        if(machine?.animation===sample.machineAnimation)demos.set(plan.poiId,{...sample,owner:p.id});
      }
    }
    for(const id of [...this.emotes.keys()])if(!wanted.has(id)){this.emotes.get(id).destroy();this.emotes.delete(id);}
    for(const [poi,machine] of this.scene.machineVisuals||[]){
      const demo=demos.get(poi);if(demo)machine.play(demo.progress,demo.owner);else machine.reset();
    }
  }
}
