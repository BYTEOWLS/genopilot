import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {ParameterList, type ParameterRow} from '../../src/ui/components/parameter-list.js';

// Only labels and values the tests pass in are asserted.

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

class TestOutput extends Writable {
  readonly columns = 120;
  readonly rows = 20;
  readonly isTTY = false;
  output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

function renderList(context: TestContext, rows: readonly ParameterRow[], selectedId?: string) {
  const input = new TestInput();
  const output = new TestOutput();
  const instance = render(<ParameterList rows={rows} selectedId={selectedId} inputActive />, {
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  context.after(() => instance.unmount());
  return {input, output};
}

test('aligns every value in one column, whatever the label length', async context => {
  const {output} = renderList(context, [
    {id: 'short', label: 'A', value: 'first value'},
    {id: 'long', label: 'A much longer label', value: 'second value'},
  ]);
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  const lines = output.output.split('\n');
  const column = (value: string): number => lines.find(line => line.includes(value))?.indexOf(value) ?? -1;

  assert.ok(column('first value') > 0);
  assert.equal(column('first value'), column('second value'));
});

test('marks only a selected editable row and edits it in place', async context => {
  const edits: string[] = [];
  const {input, output} = renderList(context, [
    {id: 'fixed', label: 'Fixed', value: 'fixed value'},
    {id: 'editable', label: 'Editable', value: 'old', edit: {defaultValue: 'old', onChange: value => edits.push(value)}},
  ], 'editable');
  await new Promise<void>(resolve => setTimeout(resolve, 30));

  assert.match(output.output, /^› Editable/m);
  assert.doesNotMatch(output.output, /^› Fixed/m);
  input.write('er');
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  assert.equal(edits.at(-1), 'older');
});

test('never marks or edits a read-only row, even when selected', async context => {
  const {output} = renderList(context, [{id: 'fixed', label: 'Fixed', value: 'fixed value'}], 'fixed');
  await new Promise<void>(resolve => setTimeout(resolve, 30));

  assert.doesNotMatch(output.output, /^›/m);
  assert.match(output.output, /fixed value/);
});
