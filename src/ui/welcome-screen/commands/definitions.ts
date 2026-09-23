export type CommandGroup = 'primary' | 'secondary';

export type CommandDefinition<Id extends string = string> = {
  id: Id;
  label: string;
  description: string;
  group: CommandGroup;
};

export const welcomeCommands = [
  {id: 'new-run', label: 'New run', description: 'Start a new workflow run', group: 'primary'},
  {
    id: 'open-run',
    label: 'Open existing run',
    description: 'Resume, continue, rerun, or present a run',
    group: 'primary',
  },
  {id: 'help', label: 'Help', description: 'Show usage information', group: 'primary'},
  {
    id: 'manage-isolates',
    label: 'Manage isolates',
    description: 'Create, edit, and reuse isolate metadata',
    group: 'secondary',
  },
  {
    id: 'ncbi-access',
    label: 'Manage NCBI accessions',
    description: 'Inspect cached accessions and configure the optional NCBI Datasets API key',
    group: 'secondary',
  },
  {
    id: 'check-tooling',
    label: 'Manage tooling',
    description: 'Inspect the workflow runtime',
    group: 'secondary',
  },
] as const satisfies readonly CommandDefinition[];

export type WelcomeCommandId = (typeof welcomeCommands)[number]['id'];

export function groupCommands<Id extends string>(
  commands: readonly CommandDefinition<Id>[],
): Record<CommandGroup, readonly CommandDefinition<Id>[]> {
  return {
    primary: commands.filter(command => command.group === 'primary'),
    secondary: commands.filter(command => command.group === 'secondary'),
  };
}

/** Returns the adjacent command ID while keeping labels presentation-only. */
export function moveCommandSelection<Id extends string>(
  commands: readonly CommandDefinition<Id>[],
  selectedId: Id,
  offset: -1 | 1,
): Id {
  const grouped = groupCommands(commands);
  const displayedCommands = [...grouped.primary, ...grouped.secondary];
  const selectedIndex = displayedCommands.findIndex(command => command.id === selectedId);
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  return displayedCommands[
    (currentIndex + offset + displayedCommands.length) % displayedCommands.length
  ]?.id ?? selectedId;
}
