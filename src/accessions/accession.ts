/** A versioned NCBI assembly accession, e.g. `GCF_000149205.2`; unversioned accessions are rejected. */
export const ncbiAccessionPattern = /^GC[AF]_\d{9}\.\d+$/;

export const ncbiAccessionFormatMessage =
  'must be a versioned NCBI assembly accession (for example GCF_000149205.2)';

export function isVersionedAssemblyAccession(value: string): boolean {
  return ncbiAccessionPattern.test(value);
}

/** Tidies a typed or pasted accession, whose surrounding whitespace and case carry no meaning. */
export function normalizeAccession(value: string): string {
  return value.trim().toUpperCase();
}
