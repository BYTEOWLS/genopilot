export type CommandGroup = 'primary' | 'secondary';

export type CommandDefinition<Id extends string = string> = {
  id: Id;
  label: string;
  /** A short hint, only where the label alone does not say what the command does. */
  description?: string;
  group: CommandGroup;
};

export const welcomeCommands = [
  {id: 'new-run', label: 'New run', description: 'Configure and start a workflow', group: 'primary'},
  {id: 'open-run', label: 'Open existing run', description: 'View results or delete a run', group: 'primary'},
  {id: 'help', label: 'Help', group: 'primary'},
  {id: 'manage-isolates', label: 'Manage isolates', group: 'secondary'},
  {id: 'manage-accessions', label: 'Manage NCBI accessions', group: 'secondary'},
  {id: 'check-tooling', label: 'Manage tooling', group: 'secondary'},
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
