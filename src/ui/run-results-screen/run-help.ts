import type {HelpEntry, HelpSection} from '../components/help.js';

/** Workflow-independent explanations keyed by the run-level result item IDs. */
const runExplanations: Record<string, string> = {
  'run.id': 'Unique identifier generated when the run was created. It names the run directory and never changes.',
  'run.name': 'Optional label entered when the run was created. It does not need to be unique.',
  'run.description': 'Optional free-text description entered when the run was created.',
  'run.workflow': 'Workflow label with its stable identifier and version. Results are interpreted by identifier and ' +
    'version, so a changed label does not affect loading.',
  'run.created': 'Time the run workspace was created, shown in local time.',
  'run.summary_generated': 'Time the workflow wrote the completion summary, shown in local time. A later rerun of ' +
    'the summary stage updates it.',
  'run.effective_cpus': 'Number of CPUs the workflow was allowed to use after applying the selected CPU mode.',
  'run.stdout': 'Complete standard output of the Snakemake process for the execution that just ended.',
  'run.stderr': 'Complete standard error of the Snakemake process for the execution that just ended.',
  'run.directory': 'Directory containing the saved configuration, all results, and all logs of this run.',
  'run.artifacts': 'Index of the run\'s files with checksums and whether each was generated, imported, or cached.',
  'run.provenance': 'Record of commands, tool versions, resources, timestamps, effective configuration, and input ' +
    'checksums.',
  'run.logs': 'Directory containing the complete logs of every workflow step.',
};

const statusEntry: HelpEntry = {
  id: 'run.status',
  label: 'Run status',
  explanation: 'The scientific status saved by the workflow. A Snakemake process that exits successfully can still ' +
    'produce a failed validation, so this status, not the process exit, tells whether the result is usable. ' +
    'Paths marked missing do not exist now; paths marked with their availability when summarized existed or ' +
    'were absent when the summary was written.',
  values: [
    {value: 'completed', explanation: 'Transfer finished and the final GFF3 passed validation without warnings.'},
    {
      value: 'completed-with-warnings',
      explanation: 'Transfer finished and the final GFF3 passed validation, but warnings need review.',
    },
    {
      value: 'validation-failed',
      explanation: 'Transfer finished, but the final GFF3 has structural errors. All evidence is kept for review; ' +
        'do not use the annotation downstream without fixing the errors.',
    },
  ],
};

function entries(items: readonly {id: string; label: string}[]): HelpEntry[] {
  return items.map(item => ({id: item.id, label: item.label, explanation: runExplanations[item.id]}));
}

/** Help sections for the run-level items that surround the workflow-specific results. */
export function runHelpSections({
  metadataItems,
  fileItems,
  hasStatus,
  workflowSections,
}: {
  metadataItems: readonly {id: string; label: string}[];
  fileItems: readonly {id: string; label: string}[];
  hasStatus: boolean;
  workflowSections: readonly HelpSection[];
}): HelpSection[] {
  return [
    {id: 'run-metadata', title: 'Run Metadata', entries: [...entries(metadataItems), ...(hasStatus ? [statusEntry] : [])]},
    ...workflowSections,
    {id: 'run-files', title: 'Run Files', entries: entries(fileItems)},
  ];
}
