import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {chmod, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';

// Licenses a bundled package may carry; anything else fails the build until it is reviewed.
const allowedLicenses = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0']);

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
const applicationLabel = packageMetadata.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// The commit this build comes from, shown on the tooling screen (src/build-info.ts); null when
// building outside a Git checkout, such as from an archived source snapshot.
function git(...arguments_) {
  const result = spawnSync('git', arguments_, {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : undefined;
}
const [commit, committedAt] = git('log', '-1', '--format=%H%n%cI')?.split('\n') ?? [];
const status = git('status', '--porcelain');
// A release build is the one `pnpm publish` makes (`prepublishOnly`); it must come from a commit
// without uncommitted changes, so a published version always names exactly what it was built from.
const released = process.env.GENOPILOT_RELEASE === '1';
if (released && status !== '') {
  console.error('A release build needs a working tree without uncommitted changes. Commit or stash them first.');
  process.exit(1);
}
const buildInfo = commit && committedAt && status !== undefined ? {commit, committedAt, modified: status.length > 0, released} : null;

// The CLI and everything it imports, so an installation runs exactly the locked dependencies.
const cli = await build({
  metafile: true,
  entryPoints: ['src/cli.tsx'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Identifiers stay unrenamed so stack traces in bug reports keep real function names.
  minifyWhitespace: true,
  minifySyntax: true,
  define: {'process.env.NODE_ENV': '"production"', __GENOPILOT_BUILD__: JSON.stringify(buildInfo)},
  // Ink imports its devtools only when DEV=true, and they import this optional, uninstalled package.
  alias: {'react-devtools-core': './scripts/empty-module.js'},
  // Bundled CommonJS code requires Node built-ins, which an ES module has no `require` for.
  banner: {js: "import {createRequire as __createRequire} from 'node:module';\nconst require = __createRequire(import.meta.url);"},
});
await chmod('dist/cli.js', 0o755);

await mkdir('dist/browser/assets', {recursive: true});
const page = await build({metafile: true, entryPoints: ['src/browser/page/main.tsx'], outfile: 'dist/browser/assets/page.js', bundle: true, platform: 'browser', format: 'esm', minify: true, legalComments: 'eof'});
await writeFile('dist/browser/assets/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${applicationLabel} · Documentation</title><link rel="stylesheet" href="page.css"></head><body><div id="root"></div><script type="module" src="page.js"></script></body></html>`);
// IGV is loaded only for genome views, from its ESM entry rather than its non-ESM browser build.
const igv = await build({metafile: true, stdin: {contents: "export {default} from 'igv';", resolveDir: '.'}, outfile: 'dist/browser/assets/igv.js', bundle: true, platform: 'browser', format: 'esm', mainFields: ['module', 'browser', 'main'], minify: true, legalComments: 'eof'});

// The nearest package.json with a name; a nameless one, such as a module-type marker in a
// package's subdirectory, belongs to the package above it.
async function packageDirectory(input) {
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    if ((await readdir(directory)).includes('package.json')
      && JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name) {
      return directory;
    }
    directory = dirname(directory);
  }
  throw new Error(`No package.json above ${input}`);
}

function permitted(license) {
  if (typeof license !== 'string') {
    return false;
  }
  const expression = license.replaceAll(/[()]/g, '').trim();
  return expression.includes(' OR ')
    ? expression.split(' OR ').some(part => allowedLicenses.has(part.trim()))
    : expression.split(' AND ').every(part => allowedLicenses.has(part.trim()));
}

const packages = new Set();
for (const result of [cli, page, igv]) {
  for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/'))) {
    packages.add(await packageDirectory(input));
  }
}
let notices = await readFile('THIRD-PARTY-LICENSES.md', 'utf8');
const problems = [];
const listed = new Set();
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const name = `${metadata.name}@${metadata.version}`;
  if (listed.has(name)) {
    continue;
  }
  listed.add(name);
  if (!permitted(metadata.license)) {
    problems.push(`${name} has license ${JSON.stringify(metadata.license)}`);
    continue;
  }
  const files = (await readdir(directory)).filter(file => /^licen[sc]e(?:\..*)?$/i.test(file));
  notices += `\n## ${name} (${metadata.license})\n\n`;
  if (files.length === 0) {
    // Some npm tarballs omit their upstream license; keep a reviewed local copy.
    try {
      notices += await readFile(`resources/licenses/${metadata.name.replaceAll('/', '-')}.LICENSE`, 'utf8') + '\n';
    } catch {
      problems.push(`${name} has no license file and no reviewed copy in resources/licenses/`);
    }
  }
  for (const file of files.sort()) {
    notices += await readFile(join(directory, file), 'utf8') + '\n';
  }
}
if (problems.length > 0) {
  throw new Error(`Bundled packages need review:\n- ${problems.join('\n- ')}`);
}
await writeFile('dist/THIRD-PARTY-LICENSES.md', notices);
