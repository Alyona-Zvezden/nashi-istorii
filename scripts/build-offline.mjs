import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const out = (process.env.OUT_DIR || 'dist').replaceAll('\\', '/').replace(/\/$/, '');
const info = JSON.parse(await readFile(out + '/release.json', 'utf8'));
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    result.push(...(entry.isDirectory() ? await walk(path) : [path.replaceAll('\\', '/')]));
  }
  return result;
}
const files = (await walk(out)).map(file => info.base + file.slice(out.length + 1));
const sw = await readFile(out + '/sw.js', 'utf8');
if (!sw.includes('__PRECACHE__')) throw new Error('Не найден список автономных ресурсов');
await writeFile(out + '/sw.js', sw.replaceAll('__PRECACHE__', JSON.stringify(files)));
await writeFile(out + '/release.json', JSON.stringify({ ...info, files }));
let size = 0;
for (const path of await walk(out)) size += (await readFile(path)).length;
if (size > 4 * 1024 * 1024) throw new Error('Сборка превышает 4 МиБ');
console.log('Полный автономный выпуск: ' + files.length + ' ресурсов, ' + size + ' байт.');
