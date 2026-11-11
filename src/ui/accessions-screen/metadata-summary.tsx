import type {NcbiAssemblyMetadata} from '../../accessions/catalog.js';
import type {ParameterRow} from '../components/parameter-list.js';
import {formatLocalDate, formatLocalDateTime} from '../utils.js';

const sourceLabels: Record<NcbiAssemblyMetadata['source'], string> = {
  'datasets-v2-rest': 'NCBI Datasets API',
  'cached-download-report': 'NCBI assembly report from a previous download',
};

const notReported = 'not reported by NCBI';

/** A fact NCBI may leave out; its absence is said so rather than left blank. */
function reportedRow(id: string, label: string, value: string | undefined): ParameterRow {
  return value !== undefined ? {id, label, value} : {id, label, value: notReported, muted: true};
}

function count(value: number | undefined, suffix = ''): string | undefined {
  return value === undefined ? undefined : `${value.toLocaleString('en-US')}${suffix}`;
}

/** Read-only NCBI facts, grouped independently of the editable local notes. */
export function metadataSections(metadata: NcbiAssemblyMetadata): {id: string; title: string; rows: ParameterRow[]}[] {
  const assembly = [metadata.assembly_name, metadata.assembly_level, metadata.assembly_status]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
  return [
    {id: 'assembly', title: 'Assembly', rows: [
      {
        id: 'ncbi.organism',
        label: 'Organism',
        value: metadata.tax_id === undefined
          ? metadata.organism
          : `${metadata.organism} (taxon ${String(metadata.tax_id)})`,
      },
      reportedRow('ncbi.assembly', 'Assembly', assembly || undefined),
      reportedRow('ncbi.release_date', 'Release date', metadata.release_date === undefined
        ? undefined : formatLocalDate(metadata.release_date)),
      reportedRow('ncbi.assembly_type', 'Assembly type', metadata.assembly_type),
      reportedRow('ncbi.refseq_category', 'RefSeq category', metadata.refseq_category),
      reportedRow('ncbi.strain', 'Strain', metadata.strain),
      reportedRow('ncbi.submitter', 'Submitter', metadata.submitter),
      {id: 'ncbi.retrieved_at', label: 'Retrieved', value: formatLocalDateTime(metadata.retrieved_at)},
      {id: 'ncbi.source', label: 'Source', value: sourceLabels[metadata.source]},
    ]},
    {id: 'statistics', title: 'Genome statistics', rows: [
      reportedRow('ncbi.total_sequence_length', 'Genome size', count(metadata.total_sequence_length, ' bp')),
      reportedRow('ncbi.gc_percent', 'GC', metadata.gc_percent === undefined ? undefined : `${metadata.gc_percent}%`),
      reportedRow('ncbi.number_of_contigs', 'Contigs', count(metadata.number_of_contigs)),
      reportedRow('ncbi.number_of_scaffolds', 'Scaffolds', count(metadata.number_of_scaffolds)),
      reportedRow('ncbi.contig_n50', 'Contig N50', count(metadata.contig_n50, ' bp')),
      reportedRow('ncbi.scaffold_n50', 'Scaffold N50', count(metadata.scaffold_n50, ' bp')),
    ]},
    {id: 'records', title: 'Linked records', rows: [
      reportedRow('ncbi.bioproject_accession', 'BioProject', metadata.bioproject_accession
        ? `https://www.ncbi.nlm.nih.gov/bioproject/${encodeURIComponent(metadata.bioproject_accession)}` : undefined),
      reportedRow('ncbi.biosample_accession', 'BioSample', metadata.biosample_accession
        ? `https://www.ncbi.nlm.nih.gov/biosample/${encodeURIComponent(metadata.biosample_accession)}` : undefined),
    ]},
  ];
}
