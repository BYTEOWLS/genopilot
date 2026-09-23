import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCommands,
  moveCommandSelection,
  welcomeCommands,
  type CommandDefinition,
} from '../../src/ui/welcome-screen/commands/definitions.js';

const commands = [
  {id: 'create', label: 'Any create label', description: 'Create', group: 'primary'},
  {id: 'inspect', label: 'Any inspect label', description: 'Inspect', group: 'secondary'},
  {id: 'help', label: 'Any help label', description: 'Help', group: 'primary'},
] as const satisfies readonly CommandDefinition[];

test('groups welcome commands by stable ID and keeps every command visible', () => {
  const grouped = groupCommands(welcomeCommands);

  assert.deepEqual(
    new Set(grouped.primary.map(command => command.id)),
    new Set(['new-run', 'open-run', 'help']),
  );
  assert.deepEqual(
    new Set(grouped.secondary.map(command => command.id)),
    new Set(['manage-isolates', 'check-tooling', 'ncbi-access']),
  );
});

test('moves command selection by stable ID rather than display label', () => {
  const relabeled = commands.map(command => ({...command, label: `Changed ${command.label}`}));

  assert.equal(moveCommandSelection(relabeled, 'create', 1), 'help');
  assert.equal(moveCommandSelection(relabeled, 'inspect', -1), 'help');
});

test('wraps command selection in both directions', () => {
  assert.equal(moveCommandSelection(commands, 'inspect', 1), 'create');
  assert.equal(moveCommandSelection(commands, 'create', -1), 'inspect');
});
