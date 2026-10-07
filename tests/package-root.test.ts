import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import test from 'node:test';
import {packagedPath, packagedUrl, packageRoot} from '../src/package-root.js';

test('package root holds package.json and the packaged directories', () => {
  assert.ok(existsSync(new URL('package.json', packageRoot)));
  for (const directory of ['workflows/', 'docs/', 'runtime/']) {
    assert.ok(existsSync(packagedUrl(directory)), directory);
  }
  assert.ok(existsSync(packagedPath('runtime/pixi.lock')));
});
