import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React, {useState} from 'react';
import {render} from 'ink';
import {adjacentTabId, TabBar} from '../../src/ui/components/tabs.js';

const tabs = [
  {id: 'first', label: 'First'},
  {id: 'second', label: 'Second'},
  {id: 'third', label: 'Third'},
] as const;

type TabId = (typeof tabs)[number]['id'];

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
  readonly rows = 20;
  readonly isTTY = false;
  output = '';

  constructor(readonly columns = 80) {
    super();
  }

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

function renderTabs(
  context: TestContext,
  {inputActive = true, arrowKeys = true, columns}: {inputActive?: boolean; arrowKeys?: boolean; columns?: number} = {},
) {
  const input = new TestInput();
  const output = new TestOutput(columns);
  const selections: TabId[] = [];
  function Host(): React.JSX.Element {
    const [active, setActive] = useState<TabId>('first');
    return (
      <TabBar
        tabs={tabs}
        activeId={active}
        onChange={id => {
          selections.push(id);
          setActive(id);
        }}
        inputActive={inputActive}
        arrowKeys={arrowKeys}
      />
    );
  }
  const instance = render(<Host />, {
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  context.after(() => instance.unmount());
  return {input, output, selections};
}

async function press(input: TestInput, key: string): Promise<void> {
  input.write(key);
  await new Promise<void>(resolve => setTimeout(resolve, 30));
}

test('cycles tabs by ID in both directions', () => {
  assert.equal(adjacentTabId(tabs, 'first', 1), 'second');
  assert.equal(adjacentTabId(tabs, 'third', 1), 'first');
  assert.equal(adjacentTabId(tabs, 'first', -1), 'third');
});

test('switches with Tab, Shift+Tab, and ←/→', async context => {
  const {input, selections} = renderTabs(context);
  await press(input, '\t');
  await press(input, '\x1b[C');
  await press(input, '\x1b[Z');
  await press(input, '\x1b[D');

  assert.deepEqual(selections, ['second', 'third', 'second', 'first']);
});

test('leaves ←/→ to a text cursor but keeps Tab', async context => {
  const {input, selections} = renderTabs(context, {arrowKeys: false});
  await press(input, '\x1b[C');
  await press(input, '\t');

  assert.deepEqual(selections, ['second']);
});

test('ignores keys while locked', async context => {
  const {input, selections} = renderTabs(context, {inputActive: false});
  await press(input, '\t');
  await press(input, '\x1b[C');

  assert.deepEqual(selections, []);
});

test('marks the active tab without color and wraps on a narrow terminal', async context => {
  const {output} = renderTabs(context, {columns: 20});
  await new Promise<void>(resolve => setTimeout(resolve, 30));

  // FORCE_COLOR=0 (tests/setup.ts) renders plain text, so only the bracket marks the tab.
  assert.match(output.output, /\[ First \]/);
  assert.doesNotMatch(output.output, /\[ Second \]/);
  assert.ok(output.output.split('\n').filter(line => line.trim().length > 0).length > 1);
});
