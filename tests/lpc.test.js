const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { createAvatar } = require('../scripts/build-lpc-avatar');
const config = import(pathToFileURL(path.resolve('public/js/avatar/lpcConfig.js')).href);

test('emergency LPC is exactly the neutral default without glasses; demo sheet remains separate',async()=>{
  const {DEFAULT_AVATAR}=require('../lib/avatarCatalog'),{composeAvatar}=require('../lib/lpcAvatarBuilder'),{mapAppearance}=require('../lib/avatarLpcMapper');
  const neutral=await composeAvatar(DEFAULT_AVATAR),fallback=await fs.readFile('public/assets/avatars/lpc/default-avatar.png');
  assert.equal(DEFAULT_AVATAR.glasses,'none');assert.deepEqual(fallback,neutral);
  assert.ok(!mapAppearance(DEFAULT_AVATAR).layers.some(l=>['glasses','round','thin'].includes(l.id)));
  assert.ok(!fallback.equals(await fs.readFile('public/assets/avatars/lpc/test-avatar.png')));
});

test('LPC composition is reproducible, transparent and contains all 36 intact frames', async () => {
  const { LPC_APPEARANCE } = await config;
  const generated = await createAvatar(LPC_APPEARANCE);
  assert.deepEqual(generated, await fs.readFile('public/assets/avatars/lpc/test-avatar.png'));
  const { data, info } = await sharp(generated).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 576); assert.equal(info.height, 256); assert.equal(info.channels, 4);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col++) {
    let opaque = 0, minY = 64, maxY = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const alpha = data[((row * 64 + y) * 576 + col * 64 + x) * 4 + 3];
      assert.ok(alpha === 0 || alpha === 255, 'no interpolated alpha');
      if (alpha) { opaque++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (x === 0 || x === 63 || y === 0 || y === 63) assert.equal(alpha, 0, 'no clipped edges');
    }
    assert.ok(opaque > 200 && opaque < 1600);
    assert.ok(minY >= 8 && maxY <= 62);
    assert.ok((maxY - minY + 1) * .75 >= 30 && (maxY - minY + 1) * .75 <= 40);
  }
});

test('LPC direction mapping, idle facing, explicit preset boundary and attribution', async () => {
  const { directionForMovement, idleFrame, LPC_APPEARANCE } = await config;
  for (const [x,y,direction,frame] of [[0,-1,'up',0],[-1,0,'left',9],[0,1,'down',18],[1,0,'right',27]]) {
    assert.equal(directionForMovement(x,y), direction);
    assert.equal(directionForMovement(0,0,direction), direction);
    assert.equal(idleFrame(direction), frame);
  }
  await assert.rejects(createAvatar({ ...LPC_APPEARANCE, hair: 'imaginary' }), /Unsupported/);
  const manifest = JSON.parse(await fs.readFile('public/assets/avatars/lpc/sources/manifest.json'));
  assert.equal(manifest.layers.length, 9);
  for (const layer of manifest.layers) {
    assert.ok(layer.licenses.includes('OGA-BY 3.0'));
    assert.ok(layer.authors.length && layer.sourceUrl.endsWith(layer.file));
  }
});
