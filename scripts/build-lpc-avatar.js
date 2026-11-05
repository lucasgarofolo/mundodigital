// Reproducible offline composition of the nine attributed LPC layers.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public/assets/avatars/lpc');
const config = import(pathToFileURL(path.join(root, 'public/js/avatar/lpcConfig.js')).href);

const { composeLayers, readJson } = require('../lib/lpcCompositor');

async function createAvatar(appearance) {
  const { LPC_APPEARANCE } = await config;
  for (const [key, value] of Object.entries(LPC_APPEARANCE)) {
    if (appearance[key] !== value) throw new Error('Unsupported LPC appearance: ' + key);
  }
  for (const key of Object.keys(appearance)) {
    if (!(key in LPC_APPEARANCE)) throw new Error('Unknown LPC appearance field: ' + key);
  }
  const manifest = await readJson('manifest.json'), palettes = await readJson('palettes.json');
  const colors = {
    body: ['body', appearance.skin], head: ['body', appearance.skin], face: ['body', appearance.skin],
    hair: ['hair', appearance.hairColor], beard: ['hair', appearance.beardColor],
    top: ['cloth', appearance.topColor], pants: ['cloth', appearance.pantsColor], shoes: ['cloth', appearance.shoesColor],
  };
  return composeLayers(manifest.layers.map(layer => ({ ...layer, localFile: layer.id + '.png',
    palette: colors[layer.id]?.[0], color: colors[layer.id]?.[1] })), palettes);
}

if (require.main === module) config.then(async ({ LPC_APPEARANCE }) => {
  const output = path.join(assets, 'test-avatar.png');
  await fs.writeFile(output, await createAvatar(LPC_APPEARANCE));
  console.log(`LPC avatar: ${output} (576 × 256, 36 frames)`);
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { createAvatar };
