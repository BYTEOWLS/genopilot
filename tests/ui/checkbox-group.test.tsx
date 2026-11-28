import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test from 'node:test';
import React, {useState} from 'react';
import {render, useInput} from 'ink';
import {CheckboxGroup, type CheckboxRow} from '../../src/ui/components/checkbox-group.js';
import {ParameterList} from '../../src/ui/components/parameter-list.js';
import {pressKey, rendered} from '../wait.js';

class Input extends PassThrough {
  isTTY = true;
  setRawMode() { return this; }
  ref() { return this; }
  unref() { return this; }
}
class Output extends Writable {
  columns = 80;
  rows = 24;
  output = '';
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) { this.output += chunk.toString(); callback(); }
  frame() { return stripVTControlCharacters(this.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd(); }
}

test('inline checkboxes share alignment and toggling while the form owns navigation and actions', async context => {
  const input = new Input();
  const output = new Output();
  const changes: [string, boolean][] = [];
  let submissions = 0;
  function Form() {
    const [rows, setRows] = useState<CheckboxRow[]>([
      {id: 'first', label: 'Short', checked: false, description: 'first-marker'},
      {id: 'disabled', label: 'Disabled choice', checked: true, disabled: true},
      {id: 'second', label: 'Longer choice', checked: true},
    ]);
    const [selected, setSelected] = useState('first');
    const [active, setActive] = useState(true);
    useInput((value, key) => {
      if (key.tab) {
        const ids = ['first', 'disabled', 'second', 'save'];
        setSelected(ids[(ids.indexOf(selected) + 1) % ids.length]!);
      } else if (value === '!') {
        setActive(current => !current);
      } else if (key.return && selected === 'save') {
        submissions++;
      }
    });
    return <>
      <ParameterList rows={[{id: 'fixed', label: 'Other field', value: 'fixed-marker'}]} inputActive={false} labelWidth={24} />
      <CheckboxGroup rows={rows} selectedId={selected} inputActive={active} labelWidth={24}
        onChange={(id, checked) => {
          changes.push([id, checked]);
          setRows(current => current.map(row => row.id === id ? {...row, checked} : row));
        }} />
    </>;
  }
  const app = render(<Form />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  const press = async (key: string) => { await pressKey(input, key); await rendered(app); };
  await rendered(app);
  const lines = output.frame().split('\n');
  assert.equal(lines.find(line => line.includes('first-marker'))?.indexOf('[ ]'), lines.find(line => line.includes('fixed-marker'))?.indexOf('fixed-marker'));
  await press('\r');
  assert.equal(submissions, 0);
  await press(' ');
  await press('\x1b[D');
  await press('\x1b[C');
  assert.deepEqual(changes, [['first', true], ['first', false], ['first', true]]);
  await press('!');
  await press(' ');
  assert.equal(changes.length, 3, 'inactive groups ignore input');
  await press('!');
  await press('\t');
  await press(' ');
  await press('\x1b[D');
  assert.equal(changes.length, 3, 'disabled rows cannot change');
  await press('\t');
  await press(' ');
  assert.deepEqual(changes.at(-1), ['second', false]);
  await press('\t');
  await press(' ');
  await press('\r');
  assert.equal(changes.length, 4, 'focus outside the group never toggles a checkbox');
  assert.equal(submissions, 1);
});
