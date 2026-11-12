# Genome sources: NCBI and VEuPathDB

## Outcome

Researchers can catalog, cache, and use a genome from NCBI or from any VEuPathDB site (FungiDB, ToxoDB, …) wherever a workflow accepts an NCBI accession today. Each source is a separate implementation behind one interface; shared code never names a source.

## Scope and contract

### Sources

| | NCBI | VEuPathDB |
|---|---|---|
| Identifier | versioned assembly accession, `GCF_000149205.2` | the site's file prefix `<Site>-<release>_<Abbrev>`, `FungiDB-71_AnidulansFGSCA4` |
| Download | NCBI Datasets CLI | `https://<host>/a/service/raw-files/release-<N>/<Abbrev>/{fasta,gff}/data/<id>{_Genome.fasta,.gff}` |
| Metadata | Datasets v2 REST assembly report | WDK `organism` record |
| API key | optional, `NCBI_API_KEY` | required, `VEUPATHDB_API_KEY`, sent as `Authorization: Bearer` |
| Cache folder | `ncbi-accessions-cache` | `veupathdb-cache` |

- A VEuPathDB identifier pins the release; the same organism in another release is another genome. A release the site no longer offers fails clearly and never falls back to the current one.
- Supported VEuPathDB sites are one fixed table of site prefix and host. Identifiers use only letters, digits, `-`, and `_`, so they are safe directory names on every OS; an organism abbreviation outside `[A-Za-z0-9]` is rejected, not rewritten.
- Whole-genome FASTA and GFF only; no per-chromosome download.

### Shared contract

- **Interface** (`src/genome-sources/`): a source has an id, label, cache folder name, API-key env var and whether the key is required, identifier validation, metadata validation, fetch, and summary, and a reader for the report cached with a download. One registry lists the implementations; shared code iterates it.
- **Catalog entry**: `{id, source, name?, description?, metadata, cached_copies}`. Shared code validates the envelope; the source validates `metadata`. Replaces the `ncbi` field; `schema_version` stays `1` (unreleased, no migration).
- **Workflow input**: `{source: local | <source id>, accession, cache_mode: reuse | refresh}`; `ncbi_cache_mode` becomes `cache_mode`.
- **Cache**: `<output_root>/<cache folder>/<id>/` holding `genomic.fna`, `genomic.gff`, `checksums.json`, and the source's own report. Discovery, verification, and deletion are shared.
- **API keys**: one owner-only file per source (directory `0700`, file `0600`), set, replaced, and cleared on the API-key tab of Manage accessions, never shown in full. Execution passes each stored key in its env var; a missing required key fails application validation.
- **Resolver**: `resolve_input.py` keeps local inputs, caching, checksums, and provenance, and dispatches downloads to one module per source. VEuPathDB uses the standard library and reads the key from the environment only, never from arguments or logs. Provenance records the source, identifier, and source-specific facts (Datasets CLI version; site, release, and file URLs).

### Implementation order

- [ ] Move NCBI behind the interface without changing behavior; existing tests pass.
- [ ] Generalize the catalog envelope, `cache_mode`, the key store, cache discovery, and the resolver dispatch.
- [ ] Add the VEuPathDB implementation in TypeScript and Python, its key row, and its documentation.
- [ ] Verify with a real VEuPathDB key: a current and an older release, a rerun that reuses the cache, and a missing key.

## Acceptance criteria

- [ ] `FungiDB-71_AnidulansFGSCA4` works as annotation-transfer reference and target and as reference-consensus backbone; NCBI inputs behave as before.
- [ ] A rerun reuses a verified VEuPathDB cache entry; `refresh` downloads again.
- [ ] Manage accessions catalogs, discovers, and deletes genomes of both sources.
- [ ] Without a stored VEuPathDB key, a configuration with a VEuPathDB input fails validation before the run starts.
- [ ] No API key appears in a command, log, provenance file, or error message.
- [ ] Workflow READMEs, `citation/`, `docs/`, and `CHANGELOG.md` describe both sources; `docs/` and shared code name no source.
