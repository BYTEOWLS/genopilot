import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {
  createMouseWheelInput,
  disableMouseReporting,
  enableMouseReporting,
  translateMouseInput,
} from '../../src/ui/mouse-wheel.js';

const UP = '\x1b[A';
const DOWN = '\x1b[B';

test('turns wheel reports into arrow keys, also with modifier keys held', () => {
  assert.equal(translateMouseInput('\x1b[<64;10;5M').output, UP);
  assert.equal(translateMouseInput('\x1b[<65;10;5M').output, DOWN);
  assert.equal(translateMouseInput('\x1b[<69;1;1M\x1b[<64;1;1M').output, DOWN + UP);
});

test('drops clicks, releases, and horizontal scrolling', () => {
  assert.equal(translateMouseInput('\x1b[<0;3;4M\x1b[<0;3;4m\x1b[<66;1;1M').output, '');
});

test('passes keys and pasted text unchanged around reports', () => {
  assert.equal(translateMouseInput(`a${'\x1b[<65;2;2M'}b\x1b${UP}\r`).output, `a${DOWN}b\x1b${UP}\r`);
  assert.equal(translateMouseInput('/data/<sample>_R1.fastq.gz').output, '/data/<sample>_R1.fastq.gz');
  // A lone Esc at the end is a key press, not the start of a report.
  assert.deepEqual(translateMouseInput('\x1b'), {output: '\x1b', pending: ''});
  // Alt+[ sends Esc and [, which must not wait for the next key.
  assert.deepEqual(translateMouseInput('\x1b['), {output: '\x1b[', pending: ''});
});

test('completes a report split across chunks', () => {
  const first = translateMouseInput('x\x1b[<65;1');
  assert.deepEqual(first, {output: 'x', pending: '\x1b[<65;1'});
  assert.deepEqual(translateMouseInput(';1M', first.pending), {output: DOWN, pending: ''});
});

class Source extends PassThrough {
  readonly isTTY = true;
  rawModes: boolean[] = [];
  refs: string[] = [];
  setRawMode(mode: boolean): this {
    this.rawModes.push(mode);
    return this;
  }
  ref(): this {
    this.refs.push('ref');
    return this;
  }
  unref(): this {
    this.refs.push('unref');
    return this;
  }
}

test('reports the mouse only while the application reads keys, and feeds it translated input', async () => {
  const source = new Source();
  let written = '';
  const mouse = createMouseWheelInput(source as unknown as NodeJS.ReadStream, {write: text => { written += text; }});
  assert.equal(written, '', 'nothing is reported before the application reads keys');
  assert.equal(mouse.stdin.isTTY, true);

  const received: string[] = [];
  mouse.stdin.on('data', chunk => received.push(chunk.toString()));
  mouse.stdin.setRawMode(true);
  mouse.stdin.ref();
  mouse.stdin.setRawMode(true);
  assert.deepEqual(source.rawModes, [true, true]);
  assert.equal(written, enableMouseReporting, 'reporting starts once');
  // Only the application may unref the input; doing it here would end the process at once.
  assert.deepEqual(source.refs, ['ref']);

  source.write('\x1b[<64;1;1Mq');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, [`${UP}q`]);

  mouse.stdin.setRawMode(false);
  assert.equal(written, enableMouseReporting + disableMouseReporting, 'reporting stops with key input');
  source.write('after');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, [`${UP}q`], 'nothing is forwarded while keys are not read');

  mouse.stdin.setRawMode(true);
  mouse.dispose();
  mouse.dispose();
  assert.equal(written, (enableMouseReporting + disableMouseReporting).repeat(2), 'dispose stops reporting once');
});
