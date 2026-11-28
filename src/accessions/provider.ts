import type {GenomeMetadata} from './metadata.js';

export type GenomeReference = {source: string; id: string; parameters: Record<string, unknown>};
export const artifactFiles = {
  fasta: 'genomic.fna', gff3: 'genomic.gff', proteins: 'proteins.faa', transcripts: 'transcripts.fna', cds: 'cds.fna',
} as const;
export type FileKind = keyof typeof artifactFiles;
export const fileKinds = Object.keys(artifactFiles) as FileKind[];
export type ArtifactPaths = Partial<Record<FileKind, string>>;
export type ArtifactDigests = Partial<Record<`${FileKind}_sha256`, string>>;
export type GenomeArtifact = {kind: FileKind; label: string};
export type ProviderField = {id: string; label: string; kind: 'secret'; required: boolean};
export type GenomeDownloadProgress =
  | {phase: 'requesting' | 'extracting' | 'verifying' | 'publishing'}
  | {phase: 'downloading'; bytes: number; total?: number};
export type ProviderContext = {
  signal: AbortSignal;
  secrets: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: GenomeDownloadProgress) => void;
  /** Provider-declared discovery site; credentials remain separate. */
  site?: string;
};
export type DownloadFacts = {
  files: ArtifactPaths;
  /** Optional byte-identical evidence for derived artifacts, under original/<artifact filename>. */
  originals?: ArtifactPaths;
  metadata: unknown;
  facts: Record<string, unknown>;
  annotation: 'available' | 'unavailable' | 'not-requested';
};
export type GenomeResult = {reference: GenomeReference; summary: string};

export interface GenomeProvider {
  id: string;
  label: string;
  description: string;
  cacheDirectory: string;
  fields: readonly ProviderField[];
  artifacts: readonly GenomeArtifact[];
  /** Nonsecret choices become part of the canonical reference and cache identity. */
  downloadOptions?: readonly {
    id: string;
    label: string;
    description: string;
    defaultValue: boolean;
    checked(reference: GenomeReference): boolean;
    apply(reference: GenomeReference, checked: boolean): GenomeReference;
  }[];
  sites?: readonly {id: string; label: string}[];
  validateReference(id: string, parameters: unknown): GenomeReference;
  validateMetadata(metadata: unknown): void;
  metadataSummary(metadata: unknown): string;
  downloadSummary?(facts: Record<string, unknown>): string | undefined;
  /** Map validated provider facts into the shared genome contract, including unavailable facts. */
  mapMetadata(metadata: unknown): GenomeMetadata;
  resolveExact(id: string, context: ProviderContext): Promise<GenomeReference>;
  download(reference: GenomeReference, kinds: readonly FileKind[], stagingDirectory: string, context: ProviderContext): Promise<DownloadFacts>;
  lookupMetadata?(reference: GenomeReference, context: ProviderContext): Promise<unknown>;
  search?(query: string, context: ProviderContext): Promise<GenomeResult[]>;
  browse?(context: ProviderContext): Promise<GenomeResult[]>;
}

export function referenceKey(reference: Pick<GenomeReference, 'source' | 'id'>): string {
  return JSON.stringify([reference.source, reference.id]);
}

export function sameReference(left: Pick<GenomeReference, 'source' | 'id'>, right: Pick<GenomeReference, 'source' | 'id'>): boolean {
  return left.source === right.source && left.id === right.id;
}

export class GenomeProviderRegistry {
  private readonly providers = new Map<string, GenomeProvider>();

  constructor(providers: readonly GenomeProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: GenomeProvider): void {
    if (!/^[a-z][a-z0-9-]*$/.test(provider.id) || !/^[a-z][a-z0-9-]*$/.test(provider.cacheDirectory)) {
      throw new Error('Invalid provider or cache directory ID.');
    }
    if (this.has(provider.id) || this.list().some(other => other.cacheDirectory === provider.cacheDirectory)) {
      throw new Error('Duplicate provider or cache directory.');
    }
    const artifacts = new Set<FileKind>();
    for (const artifact of provider.artifacts) {
      if (!fileKinds.includes(artifact.kind) || !artifact.label.trim() || artifacts.has(artifact.kind)) {
        throw new Error('Invalid or duplicate provider artifact.');
      }
      artifacts.add(artifact.kind);
    }
    if (artifacts.size === 0) {
      throw new Error('A genome provider must declare downloadable artifacts.');
    }
    if (provider.sites && (provider.sites.length === 0 || new Set(provider.sites.map(site => site.id)).size !== provider.sites.length
      || provider.sites.some(site => !/^[A-Za-z][A-Za-z0-9-]*$/.test(site.id) || !site.label.trim()))) {
      throw new Error('Invalid provider discovery sites.');
    }
    const fields = new Set<string>();
    for (const field of provider.fields) {
      if (!/^[a-z][a-z0-9-]*$/.test(field.id) || field.kind !== 'secret' || typeof field.required !== 'boolean' || fields.has(field.id)) {
        throw new Error('Invalid or duplicate provider setup field.');
      }
      fields.add(field.id);
    }
    this.providers.set(provider.id, provider);
  }

  list(): GenomeProvider[] {
    return [...this.providers.values()];
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): GenomeProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error('Unknown genome provider.');
    }
    return provider;
  }

  validateReference(value: unknown): GenomeReference {
    if (typeof value !== 'object' || value === null || !('source' in value) || !('id' in value) || !('parameters' in value)
      || typeof value.source !== 'string' || typeof value.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.id)) {
      throw new Error('Invalid genome reference: source, safe canonical id, and parameters are required.');
    }
    const result = this.get(value.source).validateReference(value.id, value.parameters);
    if (result.source !== value.source || result.id !== value.id) {
      throw new Error('Genome reference is not canonical.');
    }
    return result;
  }
}

export function missingProviderFields(provider: GenomeProvider, secrets: Readonly<Record<string, string>>): ProviderField[] {
  return provider.fields.filter(field => field.required && !secrets[field.id]?.trim());
}
