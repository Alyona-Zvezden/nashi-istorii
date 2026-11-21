import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
const source = 'sources/Наши_истории_60_вопросов_редакция.xlsx';
const bytes = readFileSync(source);
const manifest = JSON.parse(readFileSync('sources/MANIFEST.json', 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[0].sha256) throw new Error('Изменён исходный Excel');
const zip = unzipSync(bytes);
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : value?.['#text'] ?? '';
const shared = zip['xl/sharedStrings.xml']
  ? list(parser.parse(strFromU8(zip['xl/sharedStrings.xml'])).sst.si).map(si => si.t ? text(si.t) : list(si.r).map(r => text(r.t)).join('')) : [];
const rows = list(parser.parse(strFromU8(zip['xl/worksheets/sheet1.xml'])).worksheet.sheetData.row);
const themes = ['Детство и воспоминания', 'Я и моя жизнь', 'Любовь и отношения', 'Мечты и желания', 'Жизнь и её смыслы', 'Неожиданные вопросы'];
const ids = ['childhood', 'self', 'relationships', 'dreams', 'meanings', 'unexpected'];
const questions = rows.slice(1).map((row, index) => {
  const values = Object.fromEntries(list(row.c).map(c => [
    c['@_r'].replace(/\d/g, ''),
    c['@_t'] === 's' ? shared[Number(c.v)] : c['@_t'] === 'inlineStr' ? text(c.is.t) : text(c.v),
  ]));
  const depth = Number(values.C.match(/^Уровень ([123]) /)?.[1]);
  const themeId = ids[themes.indexOf(values.B)];
  if (!depth || !themeId || !values.A) throw new Error('Неизвестная карточка: строка ' + row['@_r']);
  return { id: 'q' + String(index + 1).padStart(3, '0'), displayNumber: index + 1,
    text: values.A, themeId, depth, sourceRow: Number(row['@_r']) };
});
const matrix = ids.map(id => [1,2,3].map(depth => questions.filter(q => q.themeId === id && q.depth === depth).length));
if (questions.length !== 60 || JSON.stringify(matrix) !== JSON.stringify([[6,3,1],[3,5,2],[2,5,3],[5,4,1],[1,4,5],[4,4,2]])) throw new Error('Неверный состав колоды');
const deck = { deckVersion: 'base-60-v1', questions };
if (process.argv.includes('--write')) writeFileSync('src/content/deck.json', JSON.stringify(deck, null, 2) + '\n');
else if (JSON.stringify(deck) !== JSON.stringify(JSON.parse(readFileSync('src/content/deck.json', 'utf8')))) throw new Error('Колода не соответствует Excel');
console.log('Excel: все 60 карточек совпадают; 6×10, глубина 21/25/14.');
