import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const segments = ['backend', 'internal', 'webui', 'dist'];
let target = root;
for (const segment of segments) {
 target = path.join(target, segment);
 await fs.mkdir(target, { recursive: true });
 const info = await fs.lstat(target);
 if (info.isSymbolicLink()) throw new Error('Refusing to clean a linked build directory');
}
if (target !== path.join(root, ...segments) || !target.startsWith(root + path.sep)) throw new Error('Build output is outside the project');
for (const name of await fs.readdir(target)) {
 if (name === '.keep') continue;
 const file = path.join(target, name);
 if (path.dirname(file) !== target) throw new Error('Unexpected build artifact path');
 await fs.rm(file, { recursive: true, force: true });
}
await fs.writeFile(path.join(target, '.keep'), '\n');
