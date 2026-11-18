import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const assets = new URL('../backend/internal/webui/dist/assets/', import.meta.url);
for (const file of await readdir(assets)) {
  if (!/\.(?:js|css)$/.test(file)) continue;
  const target = new URL(file, assets);
  const content = await readFile(target);
  const compressed = gzipSync(content, { level: 9 });
  if (compressed.length < content.length) {
    await writeFile(new URL(file + '.gz', assets), compressed);
  }
}
