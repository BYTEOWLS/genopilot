import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import test from 'node:test';
import React, {useState} from 'react';
import {render, Text} from 'ink';
import {ElapsedTime} from '../../src/ui/components/elapsed-time.js';

class TestOutput extends Writable {
  columns = 80;
  rows = 10;
  readonly isTTY = false;
  private lastFrame = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.lastFrame = chunk.toString();
    callback();
  }

  frame(): string {
    return this.lastFrame;
  }
}

/** Lets React run its scheduled effects and renders; `setImmediate` is not mocked. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('ticks each second, freezes at the end, and leaves its parent unrendered', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1_000_000});
  let parentRenders = 0;
  let finish: (endedAt: number) => void = () => undefined;
  function Parent(): React.JSX.Element {
    parentRenders += 1;
    const [endedAt, setEndedAt] = useState<number | undefined>();
    finish = setEndedAt;
    return (
      <>
        <Text>log</Text>
        <ElapsedTime startedAt={1_000_000 - 500} {...(endedAt === undefined ? {} : {endedAt})} />
      </>
    );
  }
  const output = new TestOutput();
  const instance = render(<Parent />, {stdout: output as unknown as NodeJS.WriteStream, debug: true, patchConsole: false});
  await settle();
  assert.match(output.frame(), /\b0 s\b/);
  const rendersBeforeTicks = parentRenders;

  context.mock.timers.tick(500);
  await settle();
  assert.match(output.frame(), /\b1 s\b/);
  context.mock.timers.tick(61_000);
  await settle();
  assert.match(output.frame(), /\b1 min 2 s\b/);
  assert.equal(parentRenders, rendersBeforeTicks);

  finish(1_000_000 + 3_600_000);
  await settle();
  assert.match(output.frame(), /\b1 h 0 min 0 s\b/);
  context.mock.timers.tick(5_000);
  await settle();
  assert.match(output.frame(), /\b1 h 0 min 0 s\b/);
  instance.unmount();
});
