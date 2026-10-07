import assert from 'node:assert/strict';
import test from 'node:test';
import {gitBuildInfo, readBuildInfo, type GitRunner} from '../src/build-info.js';

function git(outputs: Record<string, string | undefined>): GitRunner {
  return arguments_ => outputs[arguments_[0] as string];
}

test('reads the commit, its date, and a clean working tree', () => {
  assert.deepEqual(
    gitBuildInfo(git({log: 'abc123\n2026-10-07T08:30:00+02:00\n', status: ''})),
    {commit: 'abc123', committedAt: '2026-10-07T08:30:00+02:00', modified: false, released: false},
  );
});

test('marks a working tree with uncommitted changes as modified', () => {
  assert.equal(gitBuildInfo(git({log: 'abc123\n2026-10-07T08:30:00+02:00\n', status: ' M src/cli.tsx\n'}))?.modified, true);
});

test('reports nothing outside a Git checkout', () => {
  assert.equal(gitBuildInfo(git({})), undefined);
  assert.equal(gitBuildInfo(git({log: 'abc123\n2026-10-07T08:30:00+02:00\n'})), undefined);
});

test('the sources read their commit from this checkout', () => {
  const info = readBuildInfo();
  // The repository may be checked out without Git metadata, such as from an archive.
  if (info) {
    assert.match(info.commit, /^[0-9a-f]{40}$/);
    assert.ok(!Number.isNaN(Date.parse(info.committedAt)));
  }
});
