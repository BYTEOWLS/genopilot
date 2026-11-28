# VEuPathDB API investigation

Supporting evidence for [task 01, step 6](01_genome_sources.md). The initial FungiDB investigation below is supplemented by the implemented provider's live checks in the final section. Requests used a locally supplied Bearer key; no key, raw genome, or complete service response is retained here.

## Whole-genome result

Organism discovery finds **Aspergillus nidulans FGSC A4**:

- Record key: `source_id: NCBITAXON_227321`, `project_id: FungiDB`.
- File abbreviation: `AnidulansFGSCA4`; assembly: `GCA_000149205.2`.
- Service root reports release `71`. Metadata describes eight chromosomes.
- The complete genome FASTA and GFF3 were downloaded and inspected outside the repository. No chromosome concatenation is needed.

| Artifact | Observed contents |
|---|---|
| Genome FASTA | 31,026,935 bytes; nine sequences: chromosomes I–VIII and the mitochondrial sequence; 30,517,218 bases total |
| GFF3 | 15,685,974 bytes; `##gff-version 3`; features and sequence-region directives for all nine sequences; no feature sequence ID absent from the FASTA |

SHA-256 of the observed downloads:

```text
Genome FASTA: a148c2161d7f5411c58af46fe3ec0411bc9a38c9a09a99076d8fd600fe80d46f
GFF3:        ed1b99439c34750cfe36f327682564a6d9dd022200e1ac566a4e2e7bc27b4719
```

GFF3 gene types include `protein_coding_gene`, `ncRNA_gene`, and `pseudogene`, not just `gene`; consumers must not assume a literal `gene` type represents all genes.

## Discovery and exact metadata

Base: `https://fungidb.org/fungidb/service`.

- `GET /` reports `projectId`, `buildNumber`, and `releaseDate`.
- `GET /record-types/organism` declares available attributes and searches.
- `GET /record-types/organism/searches/GenomeDataTypes` returns `{searchData, validation}`. Its `searchData.parameters` is empty: it lists organisms rather than taking a free-text query.
- `GET /record-types/organism/searches/GenomeDataTypes/reports/standard` with a JSON-encoded `reportConfig` returned 347 records. `meta.totalCount` and `meta.responseCount` were both 347; default pagination was `{offset: 0, numRecords: -1}`. Bounded pagination still needs verification.
- Exact organism metadata works through `single_record_question_OrganismRecordClasses_OrganismRecordClass/reports/standard`, with `primaryKeys=NCBITAXON_227321,FungiDB` and the requested attributes in `reportConfig`.

Useful verified attributes:

```text
primary_key, organism_name, species, strain, source_id, project_id,
name_for_filenames, genome_version, annotation_version,
chromosomeCount, contigCount, supercontigCount, megabps,
URLGenomeFasta, URLgff, URLproteinFasta, URLtranscriptFasta, URLcdsFasta
```

Records contain `id: [{name, value}, ...]`, `attributes`, `tables`, and `tableErrors`. Display names may contain HTML; `attributeFormat: text` requests plain attribute values.

## Shared metadata mapping

The public `/a/service/record-types/organism` schemas on all three supported sites declare `strain`, `species`, `ncbi_tax_id`, `annotation_version`, `contigCount`, `supercontigCount`, `chromosomeCount`, and `megabps`, alongside the discovery identity fields. The expanded report requests these fields in text format; synthetic tests cover numeric strings, missing/invalid values, persistence, and mapping. No new authenticated report verification was performed for this follow-up.

FungiDB's schema describes `ncbi_tax_id` as the strain taxon ID and `contigCount` as total contig count. Its `genome_version` help explicitly permits assembly IDs, provider version numbers, publication dates, or download dates. It therefore stays provider-specific, rather than being interpreted as an assembly name or release date. Rounded megabases and supercontigs are likewise retained without inventing exact bp lengths or scaffold counts. Database release is not assembly release.

## Native organism search

Inspect `GET /record-types/organism/searches/OrganismsByText` before forming requests. Its parameters include:

- `text_expression`: the query.
- `text_search_organism`: a JSON-encoded list of organism names; an empty list is rejected with HTTP 422 (`Cannot be empty`).
- `document_type`: `organism`.
- `text_fields`: a JSON-encoded list; tested fields were `organism_full`, `primary_key`, and `species`.

A POST to that search's `/reports/standard` endpoint succeeded with:

```json
{
  "searchConfig": {
    "parameters": {
      "text_expression": "nidulans",
      "text_search_organism": "<JSON-encoded organism-name list from GenomeDataTypes>",
      "document_type": "organism",
      "text_fields": "[\"organism_full\",\"primary_key\",\"species\"]"
    }
  },
  "reportConfig": {
    "attributes": ["primary_key", "name_for_filenames", "project_id"],
    "tables": [],
    "attributeFormat": "text"
  }
}
```

The organism list above was populated with all 347 discovered names, not the placeholder text. `nidulans` and the quoted phrase `"Aspergillus nidulans"` each returned one result, FGSC A4. The unquoted query `Aspergillus nidulans` returned 41 results, including other Aspergillus species; do not present it as exact-phrase matching. Typo tolerance was not tested.

Discovery so far describes the current service release. Historical-release organism search has not been established. Fetching the small organism listing and filtering names locally is another possible provider implementation; choose and document the intended query semantics rather than silently changing native search behavior.

## Release-pinned file routes

Verified base for this organism:

```text
https://fungidb.org/a/service/raw-files/release-71/AnidulansFGSCA4/
```

| Artifact | Path beneath base | Evidence |
|---|---|---|
| Genome | `fasta/data/FungiDB-71_AnidulansFGSCA4_Genome.fasta` | Full GET inspected |
| Annotation | `gff/data/FungiDB-71_AnidulansFGSCA4.gff` | Full GET inspected |
| Proteins | `fasta/data/FungiDB-71_AnidulansFGSCA4_AnnotatedProteins.fasta` | HEAD 200; contents not inspected |
| Transcripts | `fasta/data/FungiDB-71_AnidulansFGSCA4_AnnotatedTranscripts.fasta` | HEAD 200; contents not inspected |
| CDS | `fasta/data/FungiDB-71_AnidulansFGSCA4_AnnotatedCDSs.fasta` | HEAD 200; contents not inspected |

Important metadata inconsistencies:

- Returned file URLs use HTTP and `Current_Release`; they must not be used verbatim for reproducible downloads. Use verified HTTPS hosts and explicit release paths.
- `URLgff` still points to the old `/common/downloads/` layout. The authenticated `/a/service/raw-files/` route above succeeds.
- `URLcdsFasta` names `..._CDs.fasta`, which returns 404 at the pinned raw-file route. `..._AnnotatedCDSs.fasta` returns 200. Do not assume a declared link proves availability.
- Successful HEAD responses supplied attachment filenames but no `Content-Length`; transfer progress must allow an unknown total.

The equivalent genome and GFF routes under `release-70`, with `FungiDB-70_...` filenames, returned HEAD 200. Their complete contents were not downloaded. A genome route under deliberately nonexistent `release-999999` returned 404.

Without a key, the genome-file GET returned 401 (`Valid API Key required for this endpoint`). The organism-definition endpoint returned 200 without a key; authentication is not uniformly required by every metadata endpoint. Keep the planned required-key remote-operation policy explicit, rather than assuming every endpoint enforces it.

## Implementation verification

The implemented provider passed opt-in live tests for:

- Current-release discovery on FungiDB, ToxoDB, and PlasmoDB, using each site's `/a/service` root and organism report. Site/project identity is checked. A bounded two-record FungiDB report returned `responseCount: 2` and total 347; implementation uses pages of 200 and stable primary-key sorting.
- Local all-query-word matching over paged organism names/IDs/abbreviations. This deliberately differs from native `OrganismsByText`; the genome-source help states its semantics. Searching `Aspergillus nidulans` returns only FGSC A4.
- Full GET downloads and shared format/checksum validation for all five FungiDB artifact types through the actual packaged Node/Python copy bridge, from an unrelated directory. Genome FASTA contains nine sequences.
- Reuse with the test home's stored key removed; only requested artifacts are returned to consumers.
- Full release-70 genome/GFF3 GETs and an unavailable pinned release without fallback. Historical metadata contains pinned parameters only, not current organism facts.
- Pinned-Snakemake offline cross-root reuse for reference, target, and backbone inputs, with imported/downloaded-false provenance and matching checksums.
- An invalid synthetic Bearer token returns 401 for a genome-file request.

Additional component-site raw-file evidence is HEAD-only: all five release-71 routes returned 200 for ToxoDB `TgondiiARI` and PlasmoDB `PcynomolgiB`. Full files from those two sites were not downloaded. Historical organism search is not claimed.

The live workflow check exposed a parameter-ordering bug: Snakemake serializes reference parameters in sorted-key order, while the provider returns canonical order. The shared cache now normalizes the requested reference before comparing parameter snapshots; offline regression coverage includes reordered keys.

Synthetic tests retain response shapes and route semantics, not downloaded biological files. Guided workflow catalog selection now preserves complete provider references in both draft builders, previous-run prefill, and saved configurations. UI tests cover VEuPathDB metadata review and role-specific cross-root snapshots without NCBI reinterpretation.

References: https://fungidb.org/service-api.html and https://static-content.veupathdb.org/content/VEuPathDB/webServices.html. The tutorial at https://static-content.veupathdb.org/documents/Using-Web-services-Dec2023.pdf identifies the organism discovery/report path; the authenticated observations above supplement it.
