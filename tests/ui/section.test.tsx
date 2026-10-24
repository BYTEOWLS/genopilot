import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {Box, Text, renderToString} from 'ink';
import {Section} from '../../src/ui/components/section.js';
import {ParameterList} from '../../src/ui/components/parameter-list.js';

const borderCharacters = /[│╭╮╰╯─]/;

test('sections separate headings and content with whitespace, without borders or indentation', () => {
  const output = renderToString(<>
    <Section title="heading-a" marginTop={0}><Text>content-a</Text></Section>
    <Section title="heading-b"><Text>content-b</Text></Section>
  </>, {columns: 40});
  assert.deepEqual(output.split('\n'), ['heading-a', 'content-a', '', 'heading-b', 'content-b']);
});

test('nested sections preserve parameter rows and keep long headings on one line', () => {
  const output = renderToString(<Section title={'x'.repeat(80)} marginTop={0}>
    <Section title="nested" marginTop={0}>
      <ParameterList rows={[{id: 'fact', label: 'key', value: 'value'}]} inputActive={false} />
    </Section>
    <Box><Text>action</Text></Box>
  </Section>, {columns: 20});
  const lines = output.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0]!.length <= 20);
  assert.equal(lines[1], '  nested');
  assert.match(lines[2]!, /key\s+value/);
  assert.equal(lines[3], 'action');
  assert.ok(!borderCharacters.test(output));
});

test('each nested level gains two spaces through ordinary wrappers, without indenting siblings', () => {
  const output = renderToString(<>
    <Section title="outer" marginTop={0}>
      <Box flexDirection="column">
        <Section title="middle" marginTop={0}>
          <Section title="inner" marginTop={0}><Text>content</Text></Section>
        </Section>
      </Box>
    </Section>
    <Section title="sibling" marginTop={0}><Text>other</Text></Section>
  </>, {columns: 40});
  assert.deepEqual(output.split('\n'), ['outer', '  middle', '    inner', '    content', 'sibling', 'other']);
});

test('borders are opt-in, including for nested sections, and adapt to available width', () => {
  for (const columns of [24, 60]) {
    const output = renderToString(<Section title="outer" border marginTop={0}>
      <Section title="inner" marginTop={0}><Text>content</Text></Section>
    </Section>, {columns});
    const lines = output.split('\n');
    assert.ok(lines[0]!.startsWith('╭'));
    assert.ok(lines.at(-1)!.startsWith('╰'));
    assert.equal((output.match(/╭/g) ?? []).length, 1);
    assert.ok(lines.every(line => line.length <= columns));
    assert.ok(lines.some(line => line.includes('inner')));
    assert.ok(lines.some(line => line.includes('content')));
  }
});

test('nested sections can each explicitly request a border', () => {
  const output = renderToString(<Section title="outer" border marginTop={0}>
    <Section title="inner" border><Text>content</Text></Section>
  </Section>, {columns: 40});
  assert.equal((output.match(/╭/g) ?? []).length, 2);
  assert.ok(output.includes('content'));
});
