import type {NcbiAssemblyMetadata} from '../../accessions/catalog.js';
import type {ParameterRow} from '../components/parameter-list.js';
import {formatLocalDateTime} from '../utils.js';

const sourceLabels: Record<NcbiAssemblyMetadata['source'], string> = {
  'datasets-v2-rest': 'the NCBI Datasets API',
  'cached-download-report': 'the report cached with a download',
};

const notReported = 'not reported by NCBI';

/** A fact NCBI may leave out; its absence is said so rather than left blank. */
function reportedRow(id: string, label: string, value: string | undefined): ParameterRow {
  return value ? {id, label, value} : {id, label, value: notReported, muted: true};
}

/** NCBI facts as read-only parameter rows. */
export function metadataRows(metadata: NcbiAssemblyMetadata): ParameterRow[] {
  const assembly = [metadata.assembly_name, metadata.assembly_level, metadata.assembly_status]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
  return [
    {
      id: 'ncbi.organism',
      label: 'Organism',
      value: metadata.tax_id === undefined
        ? metadata.organism
        : `${metadata.organism} (taxon ${String(metadata.tax_id)})`,
    },
    reportedRow('ncbi.assembly', 'Assembly', assembly || undefined),
    reportedRow('ncbi.assembly_type', 'Assembly type', metadata.assembly_type),
    reportedRow('ncbi.refseq_category', 'RefSeq category', metadata.refseq_category),
    reportedRow('ncbi.strain', 'Strain', metadata.strain),
    reportedRow('ncbi.submitter', 'Submitter', metadata.submitter),
  ];
}

/** When and from where the NCBI facts were retrieved. */
export function metadataProvenance(metadata: NcbiAssemblyMetadata): string {
  return `Retrieved ${formatLocalDateTime(metadata.retrieved_at)} from ${sourceLabels[metadata.source]}.`;
}
