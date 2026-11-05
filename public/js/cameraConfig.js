import {WORLD} from './world-config.js';
import {INITIAL_BLOCK,INITIAL_AREA} from './macroWorldConfig.js';

// The original Sala 5 view (including the entrance door), in projected coordinates.
export const HOME_CAMERA={blockId:INITIAL_BLOCK,areaId:INITIAL_AREA,bounds:WORLD.bounds,
  center:{x:WORLD.bounds.x+WORLD.bounds.width/2,y:WORLD.bounds.y+WORLD.bounds.height/2},zoom:1};
export const FOCUS_CAMERA={zoom:1.5,transitionMs:1200,blockFadeMs:180,followSmoothingMs:240,headroom:38};
