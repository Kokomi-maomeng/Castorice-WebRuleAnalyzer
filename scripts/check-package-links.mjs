import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(process.argv[2]);
async function check(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await check(file);
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const markdown = await readFile(file, 'utf8');
    for (const link of markdown.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const target = (link[1] ?? link[2]).split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const destination = path.resolve(folder, decodeURIComponent(target));
      const relative = path.relative(directory, destination);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error(`${path.relative(directory, file)} link escapes the package: ${target}`);
      }
      await stat(destination).catch(() => {
        throw new Error(`${path.relative(directory, file)} link is missing: ${target}`);
      });
    }
  }
}
await check(directory);
