import type {MachineDetails} from '../../src/workflows/configuration-validation.js';

/** A fixed machine record for saved test configurations. */
export const testMachine: MachineDetails = {
  platform: 'linux',
  architecture: 'x64',
  cpu_model: 'Test CPU',
  cpus: 8,
  memory_bytes: 17_179_869_184,
};

/** `testMachine` as indented YAML lines under `resources:`, at the given indentation. */
export function testMachineYaml(indent: string): string {
  return [
    `${indent}machine:`,
    ...Object.entries(testMachine).map(([key, value]) => `${indent}  ${key}: ${String(value)}`),
  ].join('\n');
}
