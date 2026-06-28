// Copy static renderer assets (html/css) into dist next to the compiled JS.
// Runs as part of `npm run build` after tsc.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRenderer = resolve(root, 'src/renderer');
const outRenderer = resolve(root, 'dist/renderer');

const assets = ['index.html', 'styles.css'];

await mkdir(outRenderer, { recursive: true });
for (const name of assets) {
  await cp(resolve(srcRenderer, name), resolve(outRenderer, name));
}

console.log(`Copied ${assets.length} renderer asset(s) to dist/renderer`);
