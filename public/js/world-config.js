// Logical floor coordinates. Simplified reading of sc-site-13.jpg, never CAD measures.
import {createBlocks} from './macroWorldConfig.js';
const roomId = 'sala5_acesso';
const navigationNodes = [
  { id:'spawn_sala5', roomId, x:6, y:7.7 },
  { id:'sala5_centro', roomId, x:6, y:5 },
  { id:'bancada_a', roomId, x:3.6, y:3.9 },
  { id:'bancada_b', roomId, x:8.4, y:3.9 },
  { id:'terminal_sala5', roomId, x:6, y:3.9 },
  { id:'mesa_a', roomId, x:3.7, y:6.7 },
  { id:'mesa_b', roomId, x:8.3, y:6.7 },
  { id:'porta_sala5', roomId, x:1.9, y:8.3 },
];
const interests = [
  ['bancada_a','Bancada A'], ['bancada_b','Bancada B'],
  ['terminal_sala5','Terminal Mundo // Digital'], ['mesa_a','Mesa A'],
  ['mesa_b','Mesa B'], ['porta_sala5','Porta da Sala 5'],
];

export const WORLD = {
  tile: { width:64, height:32 },
  activeFloor:'ground_floor', activeRoom:roomId,
  bounds:{ x:-470, y:-105, width:900, height:505 },
  visitSeconds:{ min:3, max:8 },
  movement:{ radius:.24, laneRadius:.34, minSpeed:1.05, maxSpeed:1.6 },
  reference:{
    file:'assets/map/sc-site-13.jpg', status:'interpreted',
    note:'Primeira sala da fileira superior, à direita da escada vizinha à Área 34. O número 5 é uma categoria, não identificação exclusiva. Dimensões, móveis e detalhes visuais são estilizados.',
  },
  floors:{
    ground_floor:{
      id:'ground_floor', name:'Pavimento térreo',
      rooms:{
        [roomId]:{
          id:roomId, name:'Sala 5', type:'access_room',
          bounds:{x:0,y:0,width:12,height:9}, wallHeight:84,
          door:{side:'south',start:1,width:1.8},
          furniture:[
            {id:'desk_a',type:'desk',x:1,y:1.3,width:2.2,height:1},
            {id:'desk_terminal',type:'desk',x:4.9,y:1.3,width:2.2,height:1},
            {id:'desk_b',type:'desk',x:8.8,y:1.3,width:2.2,height:1},
            {id:'chair_a',type:'chair',x:1.7,y:2.65,width:.65,height:.65},
            {id:'chair_terminal',type:'chair',x:5.65,y:2.65,width:.65,height:.65},
            {id:'chair_b',type:'chair',x:9.55,y:2.65,width:.65,height:.65},
            {id:'desk_left',type:'desk',x:1,y:5.1,width:1.8,height:1},
            {id:'desk_right',type:'desk',x:9.2,y:5.1,width:1.8,height:1},
            {id:'chair_left',type:'chair',x:1.6,y:6.4,width:.65,height:.65},
            {id:'chair_right',type:'chair',x:9.75,y:6.4,width:.65,height:.65},
            {id:'plant_left',type:'plant',x:.6,y:3.65,width:.55,height:.55},
            {id:'plant_right',type:'plant',x:10.8,y:7.6,width:.55,height:.55},
          ],
          wallDecor:{
            sign:{x:6,y:0,height:62},
            windows:[{x:1.4,y:0,width:2},{x:9,y:0,width:1.7}],
          },
        },
      },
      context:{
        corridor:{id:'corredor_curto',bounds:{x:-3.6,y:9,width:9.4,height:1.6}},
        stairs:{id:'stairs_near_area34',bounds:{x:-3.1,y:3.5,width:2.3,height:5.1},steps:7},
      },
      spawnPoints:{
        sala5:{
          id:'spawn_sala5', roomId, nodeId:'spawn_sala5', x:6, y:7.7,
          area:{x:3.3,y:6.9,width:5.4,height:1.8},
          offsets:[[-2.3,-.5],[-.8,-.5],[.7,-.5],[2.2,-.5],[-2.3,.7],[-.8,.7],[.7,.7],[2.2,.7]],
        },
      },
      navigationNodes,
      // A short, inbound-only animation through the existing door. Not an explorable corridor.
      entry:{
        roomId,targetNode:'porta_sala5',start:{x:1.9,y:9.45},
        offsets:[[-.4,0],[0,.15],[.4,0],[-.2,.3],[.2,.3]],
          path:[{id:'outside_door',roomId,x:1.9,y:9.3},{id:'door_threshold',roomId,x:1.9,y:9},{id:'porta_sala5',roomId,x:1.9,y:8.3}],
      },
      navigationEdges:[
        ['spawn_sala5','sala5_centro'],
        ['sala5_centro','bancada_a'], ['sala5_centro','bancada_b'],
        ['sala5_centro','terminal_sala5'],
        ['sala5_centro','mesa_a'], ['sala5_centro','mesa_b'],
        ['mesa_a','porta_sala5'],
      ],
      portals:{
        sala5_corredor:{
          id:'portal_sala5_corredor',type:'door',roomId,x:1.9,y:9,
          enabled:false,targetFloor:'ground_floor',targetRoom:'corredor_futuro',
        },
        stairs_near_area34:{
          id:'stairs_near_area34',type:'stairs',x:-1.95,y:6,
          enabled:false,fromFloor:'ground_floor',targetFloor:'lower_floor',
        },
      },
      pointsOfInterest:interests.map(([nodeId,name])=>{
        const node=navigationNodes.find(node=>node.id===nodeId);
        return {id:nodeId,name,nodeId,roomId,x:node.x,y:node.y};
      }),
    },
    lower_floor:{id:'lower_floor',name:'Pavimento inferior',rooms:{},spawnPoints:{},navigationNodes:[],navigationEdges:[],portals:{},pointsOfInterest:[]},
  },
};
WORLD.blocks=createBlocks(WORLD.floors.ground_floor);
