import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveOutputBuffer,
  maximumLiveLogLineCharacters,
  truncatedLiveLogMarker,
} from '../src/live-output.js';

test('preserves partial lines independently across stdout and stderr chunks', () => {
  const emitted: string[] = [];
  const buffer = new LiveOutputBuffer(lines => emitted.push(...lines));

  buffer.append('stdout', 'partial');
  buffer.append('stderr', 'warning');
  buffer.append('stdout', ' line\nnext');
  buffer.append('stderr', ' line\n');
  buffer.flush();

  assert.deepEqual(emitted, ['partial line', 'warning line', 'next']);
});

test('bounds a terminal line while retaining a truncation marker', () => {
  const emitted: string[] = [];
  const buffer = new LiveOutputBuffer(lines => emitted.push(...lines));
  buffer.append('stdout', `${'x'.repeat(maximumLiveLogLineCharacters * 2)}\n`);

  assert.equal(emitted[0]?.length, maximumLiveLogLineCharacters);
  assert.ok(emitted[0]?.endsWith(truncatedLiveLogMarker));
});
