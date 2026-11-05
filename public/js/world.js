import { WORLD } from './world-config.js';
export { WORLD };
export const groundFloor = WORLD.floors.ground_floor;

// The only world -> screen conversion, shared by scenery, labels and characters.
export function project(x, y) {
  return {x:(x-y)*WORLD.tile.width/2,y:(x+y)*WORLD.tile.height/2};
}

export function isPositionWalkable(position, radius=WORLD.movement.radius) {
  const room=groundFloor.rooms[WORLD.activeRoom];
  const {x,y}=position, b=room.bounds;
  if (!Number.isFinite(x)||!Number.isFinite(y)||x<b.x+radius||y<b.y+radius||x>b.x+b.width-radius||y>b.y+b.height-radius) return false;
  return !room.furniture.some(f=>x>f.x-radius&&x<f.x+f.width+radius&&y>f.y-radius&&y<f.y+f.height+radius);
}

// Tiny waypoint graph. Connections are map data, without a navigation library.
export function routeBetween(fromId, toId, floor=groundFloor) {
  const nodes=new Map(floor.navigationNodes.map(node=>[node.id,node]));
  if (!nodes.has(fromId)||!nodes.has(toId)) throw new Error('Waypoint desconhecido.');
  const queue=[fromId], previous=new Map([[fromId,null]]);
  for(let i=0;i<queue.length;i++) {
    const id=queue[i];
    if(id===toId) break;
    for(const [a,b] of floor.navigationEdges) {
      const next=a===id ? b : b===id ? a : null;
      if(next&&!previous.has(next)&&nodes.has(next)) {previous.set(next,id);queue.push(next);}
    }
  }
  if(!previous.has(toId)) throw new Error(`Waypoint inacessível: ${toId}`);
  const route=[];
  for(let id=toId;id!==null;id=previous.get(id)) route.push(nodes.get(id));
  return route.reverse().slice(1);
}

function polygon(g,points,color) {g.fillStyle(color);g.fillPoints(points,true);}

// Reused from Phase 1: locally generated isometric placeholder primitives.
export function box(g,x,y,width,length,height,color,base=0) {
  const a=project(x,y),b=project(x+width,y),c=project(x+width,y+length),d=project(x,y+length);
  const shade=factor=>Phaser.Display.Color.IntegerToColor(color).darken(factor).color;
  polygon(g,[{x:d.x,y:d.y-base},{x:c.x,y:c.y-base},{x:c.x,y:c.y-height},{x:d.x,y:d.y-height}],shade(24));
  polygon(g,[{x:b.x,y:b.y-base},{x:c.x,y:c.y-base},{x:c.x,y:c.y-height},{x:b.x,y:b.y-height}],shade(12));
  polygon(g,[a,b,c,d].map(p=>({x:p.x,y:p.y-height})),color);
}

export function floorTiles(g,bounds,colors) {
  const {x,y,width,height}=bounds;
  box(g,x,y,width,height,0,colors[0],-14);
  for(let i=0;i<width;i++) for(let j=0;j<height;j++) {
    const w=Math.min(1,width-i),h=Math.min(1,height-j);
    box(g,x+i,y+j,w-.025,h-.025,0,colors[(i+j)%colors.length]);
  }
}

function drawFurniture(scene,f) {
  const g=scene.add.graphics().setDepth(project(f.x+f.width,f.y+f.height).y);
  const {x,y,width:w,height:h}=f;
  if(f.type==='desk') {
    box(g,x+.1,y+.1,.14,.14,25,0x4a6774);
    box(g,x+w-.24,y+h-.24,.14,.14,25,0x4a6774);
    box(g,x,y,w,h,29,0xc7b595,25);
    box(g,x+.32,y+.2,w-.64,.35,32,0x4e6471,29);
    box(g,x+.42,y+.19,w-.84,.08,49,0x234351,31);
    box(g,x+.49,y+.17,w-.98,.045,46,0x70c9d2,34);
    box(g,x+.4,y+.67,w-.8,.18,31,0x7d8d8b,29);
    box(g,x+w-.26,y+.57,.12,.2,31,0xe7ded0,29);
  } else if(f.type==='chair') {
    box(g,x+.23,y+.23,.17,.17,12,0x3c505a);
    box(g,x,y,w,h,16,0x668fa2,12);
    box(g,x,y+h-.14,w,.14,30,0x7ca6b9,16);
  } else if(f.type==='plant') {
    box(g,x,y,w,h,14,0xc8b897);
    box(g,x+.08,y+.08,w-.16,h-.16,31,0x4f8b75,14);
    box(g,x+.17,y+.17,w-.34,h-.34,42,0x82b291,24);
  }
}

export function drawWorld(scene) {
  const room=groundFloor.rooms[WORLD.activeRoom],b=room.bounds;
  const {corridor,stairs}=groundFloor.context;
  const floor=scene.add.graphics().setDepth(-100);
  floorTiles(floor,corridor.bounds,[0x637d86,0x6a848b]);
  floorTiles(floor,b,[0xbac4bb,0xb4bfb6]);

  const stairArt=scene.add.graphics().setDepth(-20);
  const s=stairs.bounds;
  box(stairArt,s.x,s.y,s.width,s.height,0,0x69818b,-14);
  for(let i=0;i<stairs.steps;i++) {
    const length=s.height/stairs.steps;
    box(stairArt,s.x,s.y+i*length,s.width,length,(stairs.steps-i)*7,0x9baeb4);
  }
  box(stairArt,s.x-.12,s.y,.12,s.height,69,0x5a7786);
  box(stairArt,s.x+s.width,s.y,.12,s.height,69,0x5a7786);

  const walls=scene.add.graphics().setDepth(-10);
  box(walls,b.x-.18,b.y-.18,b.width+.36,.18,room.wallHeight,0x76939c);
  box(walls,b.x-.18,b.y,.18,b.height,room.wallHeight,0x879fa4);
  // Front walls are cut away for TV legibility; the door is an actual opening.
  const {start,width}=room.door;
  box(walls,b.x,b.y+b.height,start,.16,12,0x91a7ab);
  box(walls,b.x+start+width,b.y+b.height,b.width-start-width,.16,12,0x91a7ab);
  box(walls,b.x+b.width,b.y,.16,b.height,12,0x91a7ab);
  box(walls,b.x,b.y,b.width,.06,8,0x4e727e);
  box(walls,b.x,b.y,.06,b.height,8,0x4e727e);
  for(const window of room.wallDecor.windows) {
    box(walls,window.x,-.035,window.width,.065,66,0x243e50,29);
    box(walls,window.x+.1,-.06,window.width-.2,.06,63,0x91c2ce,32);
    box(walls,window.x+window.width/2,-.075,.07,.05,65,0xd5e5e2,30);
  }

  // Future portal only: neither map transition nor corridor navigation is active.
  const door=scene.add.graphics().setDepth(project(start+width,b.height).y);
  box(door,start-.14,b.height-.08,.14,.25,49,0xe0b188);
  box(door,start+width,b.height-.08,.14,.25,49,0xe0b188);
  box(door,start,b.height,width,.18,2,0xe0b188);
  box(door,start+.06,b.height+.16,.1,1.05,44,0x598394);
  const doorLabel=project(start+width/2,b.height+1.25);
  scene.add.text(doorLabel.x,doorLabel.y,'ACESSO',{
    fontFamily:'monospace',fontSize:'10px',color:'#bdd3d6',letterSpacing:2,
  }).setOrigin(.5).setDepth(1000);

  room.furniture.forEach(f=>drawFurniture(scene,f));
  const sign=room.wallDecor.sign,p=project(sign.x,sign.y);
  scene.add.text(p.x,p.y-sign.height,'Mundo //\nDigital',{
    fontFamily:'monospace',fontSize:'12px',fontStyle:'bold',color:'#f1ebdf',align:'center',
    backgroundColor:'#285160',padding:{x:12,y:7},
  }).setOrigin(.5).setDepth(-5);
  const badge=project(.1,3.5);
  scene.add.text(badge.x-9,badge.y-45,'05',{
    fontFamily:'monospace',fontSize:'22px',fontStyle:'bold',color:'#fae2bf',
  }).setOrigin(.5).setDepth(-5);

  const spawn=groundFloor.spawnPoints.sala5;
  const marker=scene.add.graphics().setDepth(-90);
  const markerPoints=[project(spawn.x-.7,spawn.y),project(spawn.x,spawn.y-.7),project(spawn.x+.7,spawn.y),project(spawn.x,spawn.y+.7)];
  polygon(marker,markerPoints,0x9ebdaf);
  marker.lineStyle(1,0xd5e4cc,.8);marker.strokePoints(markerPoints,true);
  const c=project(spawn.x,spawn.y);
  scene.add.text(c.x,c.y+22,'BEM-VINDO',{fontFamily:'monospace',fontSize:'9px',color:'#557c70'}).setOrigin(.5).setDepth(-80);
}
