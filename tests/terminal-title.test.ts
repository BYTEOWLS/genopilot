import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerminalTitleWriter} from '../src/terminal-title.js';

function recordingStream(isTTY: boolean): {isTTY: boolean; writes: string[]; write: (chunk: string) => void} {
  const writes: string[] = [];
  return {isTTY, writes, write: chunk => void writes.push(chunk)};
}

test('saves the caller title, sets sanitized titles once each, and restores on exit', () => {
  const stream = recordingStream(true);
  const writer = createTerminalTitleWriter(stream);
  assert.deepEqual(stream.writes, ['\u001b[22;0t']);

  writer.set('Workflows\u0007\u001b]2;injected');
  writer.set('Workflows\u0007\u001b]2;injected');
  assert.deepEqual(stream.writes.slice(1), ['\u001b]2;Workflows]2;injected\u0007']);

  writer.restore();
  writer.restore();
  writer.set('After exit');
  assert.deepEqual(stream.writes.slice(2), ['\u001b]2;\u0007', '\u001b[23;0t']);
});

test('leaves streams that are not terminals untouched', () => {
  const stream = recordingStream(false);
  const writer = createTerminalTitleWriter(stream);
  writer.set('Workflows');
  writer.restore();
  assert.deepEqual(stream.writes, []);
});
