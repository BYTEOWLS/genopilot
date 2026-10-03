import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TestContext} from 'node:test';

/** Server fixtures never depend on a prior application build. */
export async function browserAssets(t: TestContext): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-browser-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await Promise.all([
    ['index.html', '<p>test</p>'],
    ['page.js', '/* test */'],
    ['page.css', '/* test */'],
  ].map(([name, text]) => writeFile(join(directory, name!), text!)));
  return pathToFileURL(`${directory}/`);
}
