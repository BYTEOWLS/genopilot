export type GenomeReference = {source: string; id: string; parameters: Record<string, unknown>};
export type FileKind = 'fasta' | 'gff3';
export type ProviderField = {id: string; label: string; kind: 'secret'; required: boolean};
export type ProviderContext = {
  signal: AbortSignal;
  secrets: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
};
export type DownloadFacts = {
  files: {fasta: string; gff3?: string};
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
  validateReference(id: string, parameters: unknown): GenomeReference;
  validateMetadata(metadata: unknown): void;
  metadataSummary(metadata: unknown): string;
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
