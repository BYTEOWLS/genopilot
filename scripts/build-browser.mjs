import {build} from 'esbuild';
import {mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
const applicationLabel = packageMetadata.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await mkdir('dist/browser/assets', {recursive: true});
const result = await build({metafile: true, entryPoints: ['src/browser/page/main.tsx'], outfile: 'dist/browser/assets/page.js', bundle: true, platform: 'browser', format: 'esm', minify: true, legalComments: 'eof'});
await writeFile('dist/browser/assets/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${applicationLabel} · Documentation</title><link rel="stylesheet" href="page.css"></head><body><div id="root"></div><script type="module" src="page.js"></script></body></html>`);
let notices = await readFile('THIRD-PARTY-LICENSES.md', 'utf8');
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/'))) {
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    const files = await readdir(directory);
    if (files.includes('package.json')) {
      packages.add(directory);
      break;
    }
    directory = dirname(directory);
  }
}
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory)).filter(file => /^licen[sc]e(?:\..*)?$/i.test(file));
  notices += `\n## ${metadata.name}\n\n`;
  if (files.length === 0) {
    // Some npm tarballs omit their upstream license; keep a reviewed local copy.
    notices += await readFile(`resources/licenses/${metadata.name.replaceAll('/', '-')}.LICENSE`, 'utf8') + '\n';
  }
  for (const file of files.sort()) {
    notices += await readFile(join(directory, file), 'utf8') + '\n';
  }
}
await writeFile('dist/browser/THIRD-PARTY-LICENSES.md', notices);
