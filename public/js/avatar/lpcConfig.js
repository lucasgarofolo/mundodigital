// Manual proof of concept. No participant records or AI provider are involved.
export const LPC_APPEARANCE = Object.freeze({
  body: 'male', skin: 'light', head: 'human_male', face: 'neutral',
  hair: 'plain', hairColor: 'black', beard: 'trimmed', beardColor: 'black',
  glasses: 'basic_black', top: 'tshirt', topColor: 'black',
  pants: 'pants', pantsColor: 'charcoal', shoes: 'basic', shoesColor: 'black',
});

export const LPC = Object.freeze({
  texture: 'lpc-test-avatar', url: '/assets/avatars/lpc/test-avatar.png',
  frameWidth: 64, frameHeight: 64, columns: 9, scale: 1.5,
  footX: 32, footY: 60, frameRate: 10,
  directions: Object.freeze(['up', 'left', 'down', 'right']),
});

export function directionForMovement(dx, dy, previous = 'down') {
  if (Math.abs(dx) + Math.abs(dy) < .001) return previous;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
}

export function idleFrame(direction) {
  return LPC.directions.indexOf(direction) * LPC.columns;
}
