import { LPC, idleFrame, directionForMovement } from './lpcConfig.js';

export function preloadLpc(scene) {
  if (!scene.textures.exists(LPC.texture)) scene.load.spritesheet(LPC.texture, LPC.url, {
    frameWidth: LPC.frameWidth, frameHeight: LPC.frameHeight,
  });
}

export function createAvatar(scene,texture=LPC.texture,direction='down') {
  for (const direction of LPC.directions) {
    const key = `${texture}-walk-${direction}`, start = idleFrame(direction);
    if (!scene.anims.exists(key)) scene.anims.create({
      key, frames: scene.anims.generateFrameNumbers(texture, { start: start + 1, end: start + 8 }),
      frameRate: LPC.frameRate, repeat: -1,
    });
  }
  const sprite = scene.add.sprite(0, -2, texture, idleFrame(direction));
  sprite.setDisplayOrigin(LPC.footX, LPC.footY).setScale(LPC.scale);
  sprite.lpcDirection = direction;sprite.lpcTexture=texture;
  return sprite;
}

// Screen-space displacement gives coherent facing in the isometric projection.
export function updateLpcAvatar(sprite, dx, dy, state) {
  const moving = ['WALKING', 'ENTERING', 'EXITING'].includes(state) && Math.abs(dx) + Math.abs(dy) > .001;
  if (moving) {
    sprite.lpcDirection = directionForMovement(dx, dy, sprite.lpcDirection);
    sprite.play(`${sprite.lpcTexture}-walk-${sprite.lpcDirection}`, true);
  } else {
    sprite.anims.stop();
    sprite.setFrame(idleFrame(sprite.lpcDirection));
  }
}
