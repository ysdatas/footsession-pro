/* Les scripts d'une page partagent la même portée : deux « const » de même nom
   (ou une « const » et une fonction) empêchent tout le second fichier de se
   charger, et la page se casse sans qu'aucun autre test le voie. Ce test lit
   chaque page, ses scripts dans l'ordre, et cherche ces collisions. Le code
   de premier niveau du site commence en début de ligne. */
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const web = new URL('../web/', import.meta.url);
const read = (path) => readFileSync(new URL(path, web), 'utf8');
const pages = readdirSync(web).filter(f => f.endsWith('.html'));

/* Noms déclarés au premier niveau d'un script : lexical (const, let, class) ou fonction. */
function declared(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = [];
  for (const m of code.matchAll(/^(?:async\s+)?(const|let|class|function\*?)\s+([\s\S]{0,400}?)(?=[=({;\n])/gm)) {
    names.push({ kind: m[1].startsWith('function') ? 'function' : 'lexical', name: m[2].trim() });
  }
  // const a = 1, b = 2 : les noms suivants, sur la même ligne, hors de toute parenthèse.
  for (const m of code.matchAll(/^(?:const|let)\s+\w+\s*=\s*[^;\n(){}[\]`'"]*,\s*(\w+)\s*=/gm)) names.push({ kind: 'lexical', name: m[1] });
  return names.filter(n => /^[\w$]+$/.test(n.name));
}

let scripts = 0;
for (const page of pages) {
  const seen = new Map();
  for (const [, src] of read(page).matchAll(/<script src="(assets\/js\/[^"?]+)/g)) {
    scripts++;
    for (const { kind, name } of declared(read(src))) {
      const first = seen.get(name);
      if (first && first.src !== src) {
        assert.ok(first.kind === 'function' && kind === 'function',
          `${page} : « ${name} » déclaré dans ${first.src} et dans ${src} : le second fichier ne se charge pas`);
      }
      if (!first) seen.set(name, { kind, src });
    }
  }
}
assert.ok(pages.length > 20 && scripts > 200, 'les pages et leurs scripts ont bien été lus');

console.log(`page-globals : OK (${pages.length} pages, ${scripts} scripts)`);
