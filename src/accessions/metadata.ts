/** Provider-independent reported facts. Missing values are unknown, never inferred. */
export type GenomeAssembly = {
  organism?: string;
  tax_id?: number;
  assembly_name?: string;
  assembly_level?: string;
  assembly_status?: string;
  assembly_type?: string;
  refseq_category?: string;
  strain?: string;
  submitter?: string;
  /** Assembly release date, not database release or retrieval date. */
  release_date?: string;
};

export type GenomeStatistics = {
  /** Exact lengths and N50 values in base pairs; counts are non-negative integers. */
  total_sequence_length?: number;
  gc_percent?: number;
  number_of_contigs?: number;
  number_of_scaffolds?: number;
  contig_n50?: number;
  scaffold_n50?: number;
};

export type GenomeAttribute = {id: string; label: string; value: string | number};

/** Normalized projection of validated, persisted provider metadata; not a second cache. */
export type GenomeMetadata = {
  assembly: GenomeAssembly;
  statistics: GenomeStatistics;
  provider_attributes: GenomeAttribute[];
  retrieved_at?: string;
  retrieval_source?: string;
};

export function emptyGenomeMetadata(): GenomeMetadata {
  return {assembly: {}, statistics: {}, provider_attributes: []};
}
