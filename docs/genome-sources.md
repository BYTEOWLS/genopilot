# Genome sources

**Manage accessions** downloads and inspects genomes without creating a run. NCBI and VEuPathDB are registered providers. Catalog and workflow downloads use the same REST implementation. Provider help explains [NCBI](provider-ncbi.md) and [VEuPathDB, including FungiDB](provider-veupathdb.md): what each supplies, website searches, API-key setup, and the exact discovery choices.

Press `?` on the provider list in Manage tooling, on a download provider/site/result choice or action, or on a catalog detail/review action. Provider setup offers help from its save button. Text and secret fields keep `?` as input. Closing help preserves selection, artifact choices, and unsaved drafts.

## Download and inspect

Press `n` and select a provider. NCBI requires a versioned assembly accession. VEuPathDB first asks for a supported site: FungiDB, ToxoDB, or PlasmoDB. Enter a pinned identifier, or enter an organism name and select **Search**. Search lists current-release genomes whose name, record ID, or file abbreviation contains every query word, ignoring case; it does not perform fuzzy spelling correction. Select a result to review its pinned reference. Exact identifiers use `<site>-<release>_<organism abbreviation>` and can request older releases without substituting the current one. Downloads use `runs` in the current directory; there is no output-root selector. The **Output roots** tab manages other locations to scan for existing caches.

Select **Review genome** and press Enter. Every provider opens a review of the pinned identifier, parameters, output root, and metadata before downloading files. Providers with metadata lookup fetch it now; a lookup failure leaves selection available for retry without downloading. Providers without lookup clearly say metadata is unavailable.

Check the review, then choose **Save metadata only** to keep a catalog entry without fetching files, or **Download selected artifacts** to fetch them now. Use Tab or ↑/↓ to select the action and Enter to activate it. Saving metadata preserves existing labels and verified copies. To download a saved entry later, press Enter on it and choose **Download / refresh**, or use `g` while an action button is selected. This immediately downloads all provider artifacts to `runs` in the current directory and shows progress in the editor, without opening another form. Escape cancels the transfer; failures remain retryable. In text fields, `g` types normally. Download the required genomic files before selecting an entry in a workflow. PageUp/PageDown scrolls the details; Escape returns to selection without downloading. Escape during an active lookup or download cancels that operation. Failed downloads retain their catalog record for retry through the editor's download action. A failed or cancelled refresh leaves the previous verified copy usable.

## Genome metadata

Review and saved-entry details use the same **Assembly** and **Genome statistics** fields for every provider. Missing facts say **not reported**; zero remains zero. Lengths and N50 values use base pairs, and GC uses percent. Provider-specific attributes follow these fields, with retrieval provenance shown separately when available.

Providers map only equivalent reported facts. VEuPathDB supplies organism, strain, taxon ID, and contig count when available; its genome version, annotation version, chromosome/supercontig counts, and rounded genome size remain provider-specific. Rounded megabases are not presented as exact base pairs. Historical references never borrow current-release organism facts. Metadata refresh needs no genome-file download and does not change verified checksums.

## Choose artifacts

The review shows artifact checkboxes inline, using the provider's list; NCBI offers genome sequence (FASTA), genome annotation (GFF3), and annotated proteins (FASTA). VEuPathDB also offers transcripts and CDS. Each artifact covers the whole genome; chromosome files are not concatenated. All declared artifacts start checked. Use Tab or ↑/↓ to select a checkbox and Space or ←/→ to toggle it. Enter activates only the selected action button; Escape leaves the review without downloading. On short terminals, the review scrolls to the focused checkbox while action buttons remain visible. PageUp/PageDown scrolls the review details.

VEuPathDB also offers **Include mitochondrial sequences**, unchecked in new download reviews. Leaving it unchecked derives genomic FASTA and matching GFF3 without explicitly labeled mitochondrial sequences, features, or sequence-region directives. Proteins, transcripts, and CDS remain whole-genome artifacts. Unclassified sequences are retained; the filter does not infer organellar origin from sequence size. Provider-reported statistics still describe the original download.

Filtered references have an `__nuclear` ID suffix and `exclude_mitochondrial: true` in their pinned parameters, keeping them separate from whole-genome references. Existing whole-genome entries are not changed automatically; open a new download review to create the filtered variant. A saved entry's direct refresh retains its saved choice. Original genomic files are retained under `original/` in the filtered cache. The completion notice lists exclusions and removed-feature counts; `genome.json` holds the full list. Cache provenance records original and classification-input checksums, excluded sequence IDs and lengths, removed-feature counts, and per-artifact filtering facts, including across partial refreshes. Workflow reuse and refresh honor the saved choice.

Only checked artifacts are published. Mitochondrial exclusion fetches both genomic FASTA and available GFF3 as classification inputs, even when only one is selected, so independent downloads use the same exclusion set. Other downloads request only checked artifacts. An unchecked artifact already verified in the cache is retained, not deleted. FASTA and GFF3 can be downloaded independently; an annotation-, protein-, transcript-, or CDS-only entry cannot be opened as a genome until genomic FASTA is present. Other FASTA types never substitute for genomic FASTA. A workflow still requires the files for its input role, regardless of the catalog download selection. If nothing is checked, use **Save metadata only** instead of downloading. Protein FASTA contains amino-acid sequences, not genomic DNA. If an NCBI assembly supplies no proteins, deselect that artifact in download review and retry; the failed request leaves existing verified files unchanged.

If a pinned genomic FASTA changes during a sequence-only refresh, GenoPilot refuses to combine it with preserved annotation, proteins, transcripts, or CDS; refresh those artifacts together.

## Download progress

During a download, the review shows received bytes and, when the provider supplies a transfer size, a progress bar and total. Otherwise the total is marked unavailable rather than guessed. Extraction, file/checksum verification, and publication have separate progress stages; finishing the transfer alone does not mean the genome is ready.

Successful downloads are verified, rescanned, and selected. Press `v` to inspect a verified copy when the browser is available. If requested annotation is unavailable, any verified FASTA remains usable for roles that do not require GFF3. An annotation-only request with no available GFF3 keeps its metadata but publishes no empty cache. A network or annotation request failure is not reported as absent annotation.

Enter edits the selected entry's local name and description. Its **Download / refresh** action downloads directly without saving or discarding unsaved labels. PageUp/PageDown scrolls metadata and local copies while fields and action buttons remain visible. The editor also offers **Refresh metadata** when the provider supports lookup; `m` activates it outside text fields. Refresh keeps unsaved labels, failures remain retryable, and Escape cancels an active lookup. On the list, `r` rescans caches. `d` confirms removal of the entry and its copies under known roots. Entries from different providers remain separate even when their identifiers match.

## Reuse in a workflow

Download genomic FASTA in Manage accessions before configuring a workflow; roles needing annotation also require GFF3 in the same verified copy. Workflow genome fields show the full catalog, but entries without genomic FASTA cannot be selected. Choose the catalog source, focus the genome field, and press Enter to select a downloaded genome. Selection snapshots its provider, pinned identifier, and parameters; the field shows the identifier rather than the serialized snapshot. Enter opens the picker again to change a catalog selection. Identifiers cannot be typed into workflow fields; enter them in Manage accessions instead. Local-file inputs remain available.

Previous-run prefill preserves the complete provider reference. Reviews show provider-owned metadata; they do not interpret every genome as NCBI data. Conflicting copies cannot be selected. The catalog picker supports paging and resizing; inspect full conflict diagnostics in Manage accessions.

Workflow inputs save the provider, pinned identifier, parameters, and an explicit `reuse` or `refresh` cache decision. Reuse snapshots a catalog copy only when it contains every file required by that input role. Copies in another output root can be reused without downloading; the resolver rechecks their required checksums and keeps refresh and deletion excluded until copying finishes. Saving a guided run requires a downloaded copy containing every role-required file; metadata-only and incomplete entries must be downloaded first. Refresh downloads to the run's output root, leaving any cross-root copy unchanged.

Direct Snakemake execution uses the same packaged Node downloader, without the TUI or the Datasets CLI. Node must be on PATH, or `GENOPILOT_NODE_EXECUTABLE` must name its absolute executable path. Managed execution supplies that path automatically. Reused and newly downloaded inputs remain `imported`; provenance records the provider reference, facts, checksums, and whether a download occurred. Missing required annotation blocks only roles that need it.

Saved workflow configurations now use schema 2. Older configurations are rejected without migration; create a new run.

## Provider settings

**Manage tooling → Accession Providers** lists registered providers and their setup status. The download form has no Provider access section or optional-key notice. Only missing required credentials show a warning alert and a **Configure provider** action. NCBI's optional key is managed through Manage tooling; the catalog list has no provider-configuration shortcut. Escape returns through the provider list to the catalog, preserving its selection and draft. Returning rechecks settings but never starts a download automatically.

VEuPathDB requires a personal API key from its site's profile **Web Service Access** tab. The same key serves all supported component sites; site selection is not a credential setting. Requests use the key as a Bearer header, never in a URL.

Secrets are masked, stored privately on this machine, and never prefilled. Type a replacement and select **Save settings**. Ctrl+X explicitly clears the selected field's stored secret; Ctrl+U clears its draft. Clearing credentials never deletes cached genomes.

Catalog status messages use info alerts; cautions such as unavailable annotation use warning alerts. NCBI's API key is optional: its absence does not block remote operations. A provider's required credentials block remote operations only; saved entries and verified local copies remain available. **Configured** means a value is stored, not that the service has verified it.

The artifact-aware catalog uses schema 3. Incompatible catalogs are rejected without being overwritten; there is no migration. Back up an older catalog before recreating it. Verified caches can be rediscovered.
