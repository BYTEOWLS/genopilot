# VEuPathDB

## About this provider

VEuPathDB integrates genomes, annotations, and related biological data for eukaryotic pathogens and related organisms. GenoPilot supports three component sites through this provider. Choose the site before finding a genome; the site is not a separate credential setting.

| Site | Data focus | Genome search website |
|---|---|---|
| FungiDB | Fungi and oomycetes | [FungiDB genome information and statistics](https://fungidb.org/fungidb/app/search/organism/GenomeDataTypes) |
| ToxoDB | Toxoplasma and related organisms | [ToxoDB genome information and statistics](https://toxodb.org/toxo/app/search/organism/GenomeDataTypes) |
| PlasmoDB | Plasmodium | [PlasmoDB genome information and statistics](https://plasmodb.org/plasmo/app/search/organism/GenomeDataTypes) |

The websites offer many searches that GenoPilot does not expose. A newer database release does not necessarily contain a newer underlying assembly or annotation; inspect the reported genome and annotation versions separately.

## API key, especially for FungiDB

A personal VEuPathDB API key is **required** for remote discovery and downloads. The same account key serves the supported component sites.

1. Open [FungiDB](https://fungidb.org/) and sign in, or register an account.
2. Open your account's **Profile**, then the **Web Service Access** tab. The [FungiDB profile page](https://fungidb.org/fungidb/app/user/profile) requires signing in.
3. Generate a key if needed and copy the API key shown there. It is not your account password.
4. In GenoPilot, open **Manage tooling → Accession Providers → VEuPathDB**.
5. Enter the key in **API key**, move to **Save settings**, and press Enter. Return to the catalog and explicitly retry the search or download.

Do not put the key in a genome identifier, configuration file, URL, or support message. GenoPilot saves the key privately on your computer and uses it over an encrypted connection to access VEuPathDB on your behalf. Stored secrets are masked and never prefilled. **Configured** means stored, not verified by the service. If access is rejected, check the key and your account's access. Cached files remain available without a key.

## Exact discovery choices

| API concept | GenoPilot's current choice | Meaning |
|---|---|---|
| Record type | `organism` | One organism/genome record, not one chromosome or gene |
| Search | `GenomeDataTypes` | Organisms: Genome Info and Stats |
| Reporter | `standard` | Selected metadata fields from those records |
| Discovery scope | Selected site's current release | Historical-release search is not supported |
| Matching | Local, case-insensitive matching of every query word | Matches organism name, record ID, or file abbreviation; not fuzzy matching, BLAST, or native full-text search |

The listing comes from `record-types/organism/searches/GenomeDataTypes/reports/standard`. Other record types, such as `genomic-sequence`, return different objects: chromosomes or contigs rather than organism records. GenoPilot does not currently offer a record-type selector.

Search results pin the site, release, and organism abbreviation. Exact identifiers use `<site>-<release>_<organism abbreviation>` and can request a historical release directly. An unavailable pinned file never falls back to the current release. Historical metadata does not borrow current-release assembly facts.

## Files and mitochondrial exclusion

Downloads use release-pinned whole-genome raw files, not sequence records extracted from the discovery report. Genomic FASTA, GFF3, annotated proteins, transcripts, and CDS are selectable artifacts; individual chromosome files are not concatenated.

**Include mitochondrial sequences** starts unchecked in a new download review. When unchecked, GenoPilot excludes explicitly labeled mitochondrial sequences from genomic FASTA and matching GFF3, including their features and sequence-region directives. It retains unclassified sequences rather than guessing from their size. Proteins, transcripts, and CDS remain unfiltered whole-genome artifacts.

Classification reads the genomic FASTA and available GFF3 together, even when only one genomic artifact is selected. Only selected artifacts and their original sources are published. Filtered references use an `__nuclear` identifier suffix and `exclude_mitochondrial: true`, separate from whole-genome copies. Existing whole-genome entries are not changed automatically; a saved entry's direct refresh retains its saved choice.

Original selected genomic files remain under `original/` in the cache. Completion notices identify exclusions and counts; `genome.json` records full exclusion lists, original and classification-input checksums, and per-artifact provenance. Provider-reported statistics describe the unfiltered source, not the derived genome.

See [Managing accessions](genome-sources.md) for review, caching, and workflow requirements. API descriptions are available in [FungiDB API documentation](https://fungidb.org/service-api.html), the [organism schema](https://fungidb.org/a/service/record-types/organism), and the [genomic-sequence schema](https://fungidb.org/a/service/record-types/genomic-sequence).
