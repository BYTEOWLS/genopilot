import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTerminalText} from '../../src/ui/sanitize.js';

test('removes terminal control characters from rendered values', () => {
  assert.equal(
    sanitizeTerminalText('safe\u001b[31mspoofed\u0000\ntext'),
    'safe[31mspoofedtext',
  );
});
