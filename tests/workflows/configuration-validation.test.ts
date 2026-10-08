import assert from 'node:assert/strict';
import test from 'node:test';
import {
  genoPilotDetails,
  validateGenoPilot,
  type ConfigurationValidationIssue,
} from '../../src/workflows/configuration-validation.js';

const build = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  committed_at: '2026-10-07T06:30:00.000Z',
  modified: false,
  released: true,
};

function issuePaths(value: unknown): string[] {
  const issues: ConfigurationValidationIssue[] = [];
  validateGenoPilot(value, issues);
  return issues.map(issue => issue.path);
}

test('saves the version and the build with its commit date in UTC', () => {
  assert.deepEqual(
    genoPilotDetails('1.2.3', '3.8.9', {
      commit: build.commit,
      committedAt: '2026-10-07T08:30:00+02:00',
      modified: false,
      released: true,
    }),
    {version: '1.2.3', igv: '3.8.9', build},
  );
  assert.deepEqual(genoPilotDetails('1.2.3', '3.8.9', undefined), {version: '1.2.3', igv: '3.8.9'});
});

test('accepts the GenoPilot section with and without a build', () => {
  assert.deepEqual(issuePaths({version: '1.2.3', igv: '3.8.9', build}), []);
  assert.deepEqual(issuePaths({version: '1.2.3', igv: '3.8.9', build: {...build, commit: 'a'.repeat(64)}}), []);
  assert.deepEqual(issuePaths({version: '1.2.3', igv: '3.8.9'}), []);
});

test('rejects a missing section, an empty version, a missing IGV version, and an invalid build', () => {
  assert.deepEqual(issuePaths(undefined), ['$.genopilot']);
  assert.deepEqual(issuePaths({version: '', igv: '3.8.9'}), ['$.genopilot.version']);
  assert.deepEqual(issuePaths({version: '1.2.3'}), ['$.genopilot.igv']);
  assert.deepEqual(
    issuePaths({version: '1.2.3', igv: '3.8.9', build: {commit: 'abc', committed_at: '2026-10-07', modified: 'no'}}),
    [
      '$.genopilot.build.commit',
      '$.genopilot.build.committed_at',
      '$.genopilot.build.modified',
      '$.genopilot.build.released',
    ],
  );
});

test('rejects unknown GenoPilot and build fields', () => {
  assert.deepEqual(
    issuePaths({version: '1.2.3', igv: '3.8.9', label: 'GenoPilot', build: {...build, branch: 'main'}}),
    ['$.genopilot.label', '$.genopilot.build.branch'],
  );
});
