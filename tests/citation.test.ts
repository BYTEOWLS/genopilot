import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

const citation = parse(readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8')) as Record<string, unknown>;
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>;

test('CITATION.cff version matches the package version', () => {
  assert.equal(citation.version, packageJson.version);
});

test('CITATION.cff license matches the package license', () => {
  assert.equal(citation.license, packageJson.license);
});
