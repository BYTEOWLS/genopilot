import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>;

test('the published package has no runtime dependencies', () => {
  // The build bundles every dependency into dist/cli.js at the version pnpm-lock.yaml pins;
  // a runtime dependency would let a user's install resolve different code.
  assert.equal(packageJson.dependencies, undefined);
});
