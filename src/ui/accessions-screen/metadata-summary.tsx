import type {GenomeMetadata} from '../../accessions/metadata.js';
import type {ParameterRow} from '../components/parameter-list.js';
import {formatLocalDate, formatLocalDateTime} from '../utils.js';

function reportedRow(id: string, label: string, value: string | undefined): ParameterRow {
  return value !== undefined ? {id, label, value} : {id, label, value: 'not reported', muted: true};
}

function count(value: number | undefined, suffix = ''): string | undefined {
  return value === undefined ? undefined : `${value.toLocaleString('en-US')}${suffix}`;
}

/** Identical shared fields for every provider, followed by its own reported attributes. */
export function metadataSections(metadata: GenomeMetadata): {id: string; title: string; rows: ParameterRow[]}[] {
  const {assembly, statistics} = metadata;
  const organism = assembly.organism === undefined ? undefined : assembly.tax_id === undefined
    ? assembly.organism : `${assembly.organism} (taxon ${String(assembly.tax_id)})`;
  return [
    {id: 'assembly', title: 'Assembly', rows: [
      reportedRow('genome.organism', 'Organism', organism),
      reportedRow('genome.assembly_name', 'Assembly', assembly.assembly_name),
      reportedRow('genome.assembly_level', 'Assembly level', assembly.assembly_level),
      reportedRow('genome.assembly_status', 'Assembly status', assembly.assembly_status),
      reportedRow('genome.release_date', 'Release date', assembly.release_date === undefined ? undefined : formatLocalDate(assembly.release_date)),
      reportedRow('genome.assembly_type', 'Assembly type', assembly.assembly_type),
      reportedRow('genome.refseq_category', 'RefSeq category', assembly.refseq_category),
      reportedRow('genome.strain', 'Strain', assembly.strain),
      reportedRow('genome.submitter', 'Submitter', assembly.submitter),
    ]},
    {id: 'statistics', title: 'Genome statistics', rows: [
      reportedRow('genome.total_sequence_length', 'Genome size', count(statistics.total_sequence_length, ' bp')),
      reportedRow('genome.gc_percent', 'GC', statistics.gc_percent === undefined ? undefined : `${statistics.gc_percent}%`),
      reportedRow('genome.number_of_contigs', 'Contigs', count(statistics.number_of_contigs)),
      reportedRow('genome.number_of_scaffolds', 'Scaffolds', count(statistics.number_of_scaffolds)),
      reportedRow('genome.contig_n50', 'Contig N50', count(statistics.contig_n50, ' bp')),
      reportedRow('genome.scaffold_n50', 'Scaffold N50', count(statistics.scaffold_n50, ' bp')),
    ]},
    ...(metadata.provider_attributes.length ? [{id: 'provider', title: 'Provider-specific attributes',
      rows: metadata.provider_attributes.map(attribute => ({id: `provider.${attribute.id}`, label: attribute.label, value: String(attribute.value)}))}] : []),
    ...(metadata.retrieved_at || metadata.retrieval_source ? [{id: 'provenance', title: 'Metadata provenance', rows: [
      ...(metadata.retrieved_at ? [{id: 'metadata.retrieved_at', label: 'Retrieved', value: formatLocalDateTime(metadata.retrieved_at)}] : []),
      ...(metadata.retrieval_source ? [{id: 'metadata.source', label: 'Source', value: metadata.retrieval_source}] : []),
    ]}] : []),
  ];
}
