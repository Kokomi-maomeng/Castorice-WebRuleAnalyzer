import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const dist = new URL('../backend/internal/webui/dist/', import.meta.url);
const index = new URL('index.html', dist);
// Vite preserves the input HTML's line endings. Normalize the embedded entry
// so Windows checkouts and clean source archives produce an identical binary.
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace(/\r\n/g, '\n'), 'utf8');

const assets = new URL('assets/', dist);
for (const file of await readdir(assets)) {
  if (!/\.(?:js|css)$/.test(file)) continue;
  const target = new URL(file, assets);
  const content = await readFile(target);
  const compressed = gzipSync(content, { level: 9 });
  if (compressed.length < content.length) {
    await writeFile(new URL(file + '.gz', assets), compressed);
  }
}
