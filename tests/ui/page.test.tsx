import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render, Text} from 'ink';
import {EditPage, Page} from '../../src/ui/components/page.js';
import {HomeSuspensionStateContext, type HomeSuspension} from '../../src/ui/home-navigation.js';

// Only text these tests pass in is asserted; the page's own wording is presentation.

class TestOutput extends Writable {
  readonly columns = 200;
  readonly rows = 30;
  readonly isTTY = false;
  output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

function frameOf(element: React.JSX.Element, suspension?: HomeSuspension): string {
  const output = new TestOutput();
  const instance = render(
    <HomeSuspensionStateContext.Provider value={suspension}>{element}</HomeSuspensionStateContext.Provider>,
    {stdout: output as unknown as NodeJS.WriteStream, patchConsole: false},
  );
  instance.unmount();
  return output.output.replaceAll(' ', ' ');
}

/** The entries of the page's last line, its shortcut line. */
function shortcuts(frame: string): string[] {
  const line = frame.split('\n').filter(candidate => candidate.trim().length > 0).at(-1) ?? '';
  return line.split(' · ');
}

test('lists the page shortcuts first and always adds back and home', () => {
  const entries = shortcuts(frameOf(<Page title="Title" shortcuts={['x — First', false, undefined, 'y — Second']} />));

  assert.deepEqual(entries.slice(0, 2), ['x — First', 'y — Second']);
  assert.equal(entries.length, 4);
});

test('names what Esc does, or leaves it out while nothing may be left', () => {
  const named = shortcuts(frameOf(<Page title="Title" back="Test back action" />));
  const withoutBack = shortcuts(frameOf(<Page title="Title" back={false} />));

  assert.equal(named.length, 2);
  assert.ok(named[0]?.endsWith('Test back action'));
  assert.equal(withoutBack.length, 1);
});

test('leaves the home shortcut out while a text field owns its key', () => {
  assert.equal(shortcuts(frameOf(<Page title="Title" />)).length, 2);
  assert.equal(shortcuts(frameOf(<Page title="Title" />, 'typing')).length, 1);
  assert.equal(shortcuts(frameOf(<Page title="Title" />, 'busy')).length, 2);
});

test('keeps each shortcut whole when the line wraps', () => {
  const output = new TestOutput();
  Object.defineProperty(output, 'columns', {value: 30});
  const instance = render(
    <Page title="Title" shortcuts={['a — One two three', 'b — Four five six']} />,
    {stdout: output as unknown as NodeJS.WriteStream, patchConsole: false},
  );
  instance.unmount();
  const lines = output.output.replaceAll(' ', ' ').split('\n');

  assert.ok(lines.some(line => line.includes('a — One two three')));
  assert.ok(lines.some(line => line.includes('b — Four five six')));
});

test('shows the title, detail, header, and description above the content, in that order', () => {
  const frame = frameOf(
    <Page title="Test title" detail="test detail" header={<Text>test header</Text>} description="test description">
      <Text>test content</Text>
    </Page>,
  );
  const order = ['Test title', 'test detail', 'test header', 'test description', 'test content'].map(text => frame.indexOf(text));

  assert.ok(order.every(index => index >= 0));
  assert.deepEqual([...order].sort((left, right) => left - right), order);
});

test('draws the save button after the content and marks it only when selected', () => {
  const unselected = frameOf(<EditPage title="Edit" saveLabel="Test save" saveSelected={false}><Text>row</Text></EditPage>);
  const selected = frameOf(<EditPage title="Edit" saveLabel="Test save" saveSelected><Text>row</Text></EditPage>);
  const saving = frameOf(<EditPage title="Edit" saveLabel="Test save" saveSelected saving savingLabel="Test saving"><Text>row</Text></EditPage>);

  assert.match(unselected, /^ {2}\[ Test save \]$/m);
  assert.match(selected, /^› \[ Test save \]$/m);
  assert.ok(selected.indexOf('row') < selected.indexOf('[ Test save ]'));
  assert.match(saving, /Test saving/);
  assert.doesNotMatch(saving, /\[ Test save \]/);
});
