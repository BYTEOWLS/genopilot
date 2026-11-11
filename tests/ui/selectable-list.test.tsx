import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React, {useState} from 'react';
import {render, Text, useInput} from 'ink';
import {Page} from '../../src/ui/components/page.js';
import {SelectableList, SelectableTable, stepSelection} from '../../src/ui/components/selectable-list.js';
import {pressKey, rendered, waitFor} from '../wait.js';

// Only text these tests pass in is asserted; the components' own wording is presentation.

const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

const none = {upArrow: false, downArrow: false, pageUp: false, pageDown: false};

test('steps one item with the arrows and wraps around at both ends', () => {
  assert.equal(stepSelection({...none, downArrow: true}, {index: 3, count: 10, pageSize: 4}), 4);
  assert.equal(stepSelection({...none, downArrow: true}, {index: 9, count: 10, pageSize: 4}), 0);
  assert.equal(stepSelection({...none, upArrow: true}, {index: 0, count: 10, pageSize: 4}), 9);
});

test('pages by the page size, stops at the ends, and wraps from there', () => {
  assert.equal(stepSelection({...none, pageDown: true}, {index: 2, count: 10, pageSize: 4}), 6);
  assert.equal(stepSelection({...none, pageDown: true}, {index: 8, count: 10, pageSize: 4}), 9);
  assert.equal(stepSelection({...none, pageDown: true}, {index: 9, count: 10, pageSize: 4}), 0);
  assert.equal(stepSelection({...none, pageUp: true}, {index: 6, count: 10, pageSize: 4}), 2);
  assert.equal(stepSelection({...none, pageUp: true}, {index: 1, count: 10, pageSize: 4}), 0);
  assert.equal(stepSelection({...none, pageUp: true}, {index: 0, count: 10, pageSize: 4}), 9);
});

test('ignores other keys and empty lists, and clamps a selection past the end', () => {
  assert.equal(stepSelection(none, {index: 0, count: 10, pageSize: 4}), undefined);
  assert.equal(stepSelection({...none, downArrow: true}, {index: 0, count: 0, pageSize: 4}), undefined);
  assert.equal(stepSelection({...none, downArrow: true}, {index: 20, count: 10, pageSize: 4}), 0);
});

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
  rows = 30;
  columns = 100;
  readonly isTTY = true;
  output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

const itemName = (index: number): string => `item-${String(index).padStart(2, '0')}`;

/** A page with a list of `count` items, `height` lines tall, that records every selection. */
function renderList({count, height, active = true, table = false}: {count: number; height: number; active?: boolean; table?: boolean}) {
  const input = new TestInput();
  const output = new TestOutput();
  const selections: number[] = [];
  function Screen(): React.JSX.Element {
    const [selected, setSelected] = useState(0);
    // Reads every key, so an inactive list still sees keys arrive.
    useInput(() => {});
    const select = (index: number): void => {
      selections.push(index);
      setSelected(index);
    };
    const common = {selectedIndex: selected, onSelect: select, active, height, noun: 'things'};
    return (
      <Page title="Title" shortcuts={['x — Mine']}>
        {table ? (
          <SelectableTable {...common} header={['Name', 'Note']} rows={Array.from({length: count}, (_, index) => [itemName(index), 'note'])} />
        ) : (
          <SelectableList
            {...common}
            count={count}
            renderItem={(index, isSelected) => <Text>{isSelected ? '› ' : '  '}{itemName(index)}</Text>}
          />
        )}
      </Page>
    );
  }
  const instance = render(<Screen />, {
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  /** The last drawn frame. */
  const frame = (): string => {
    const frames = output.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('Title');
    return (frames.at(-1) ?? '').replaceAll(' ', ' ');
  };
  return {input, instance, selections, frame};
}

/** The shortcuts on the frame's last line, before the screen's own. */
function listShortcuts(frame: string): string[] {
  const line = frame.split('\n').filter(candidate => candidate.trim().length > 0).at(-1) ?? '';
  const entries = line.split(' · ');
  return entries.slice(0, entries.findIndex(entry => entry.includes('x — Mine')));
}

for (const table of [false, true]) {
  const kind = table ? 'table' : 'list';

  test(`a ${kind} moves its selection with the arrows and page keys, wrapping at the ends`, async () => {
    const screen = renderList({count: 20, height: 7, table});
    try {
      await rendered(screen.instance);
      for (const key of [ARROW_UP, ARROW_DOWN, PAGE_DOWN, PAGE_UP, PAGE_UP]) {
        await pressKey(screen.input, key);
        await rendered(screen.instance);
      }
      const pageSize = table ? 4 : 6;
      assert.deepEqual(screen.selections, [19, 0, pageSize, 0, 19]);
    } finally {
      screen.instance.unmount();
    }
  });

  test(`a ${kind} shows the items around the selection with its position, and adds its shortcuts to the page`, async () => {
    const screen = renderList({count: 20, height: 7, table});
    try {
      await rendered(screen.instance);
      await pressKey(screen.input, ARROW_UP);
      await waitFor(() => /› item-19/.test(screen.frame()), 'the last item is selected');
      const frame = screen.frame();
      const pageSize = table ? 4 : 6;
      for (let index = 0; index < 20; index += 1) {
        assert.equal(frame.includes(itemName(index)), index >= 20 - pageSize, itemName(index));
      }
      assert.match(frame, /things/);
      assert.equal(listShortcuts(frame).length, 2);
    } finally {
      screen.instance.unmount();
    }
  });
}

test('a list that fits shows every item, no position, and only the select shortcut', async () => {
  const screen = renderList({count: 3, height: 7});
  try {
    await waitFor(() => listShortcuts(screen.frame()).length === 1, 'the list adds its shortcut');
    const frame = screen.frame();
    assert.match(frame, /item-00[\s\S]*item-01[\s\S]*item-02/);
    assert.doesNotMatch(frame, /things/);
  } finally {
    screen.instance.unmount();
  }
});

test('an inactive list takes no keys and adds no shortcuts', async () => {
  const screen = renderList({count: 20, height: 7, active: false});
  try {
    await rendered(screen.instance);
    await pressKey(screen.input, ARROW_DOWN);
    await pressKey(screen.input, PAGE_DOWN);
    await rendered(screen.instance);
    assert.deepEqual(screen.selections, []);
    assert.deepEqual(listShortcuts(screen.frame()), []);
  } finally {
    screen.instance.unmount();
  }
});
