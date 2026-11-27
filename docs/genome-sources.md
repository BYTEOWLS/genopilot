# Genome sources

**Manage genome sources** downloads and inspects genomes without creating a run. NCBI is currently the only registered provider. Catalog and workflow downloads use the same REST implementation.

## Download and inspect

Press `n`, select a provider, and enter its exact identifier. NCBI requires a versioned assembly accession. Downloads use `runs` in the current directory; there is no output-root selector. The **Output roots** tab manages other locations to scan for existing caches.

Select **Review genome** and press Enter. Every provider opens a review of the pinned identifier, parameters, output root, and metadata before downloading files. Providers with metadata lookup fetch it now; a lookup failure leaves selection available for retry without downloading. Providers without lookup clearly say metadata is unavailable.

Check the review, then choose **Save metadata only** to keep a catalog entry without fetching files, or **Download selected artifacts** to fetch them now. Use Tab or ↑/↓ to select the action and Enter to activate it. Saving metadata preserves existing labels and verified copies. To download a saved entry later, press Enter on it and choose **Download / refresh**, or use `g` while an action button is selected. This immediately downloads all provider artifacts to `runs` in the current directory and shows progress in the editor, without opening another form. Escape cancels the transfer; failures remain retryable. In text fields, `g` types normally. Saved entries can also be selected as uncached workflow inputs for on-demand downloading. PageUp/PageDown scrolls the details; Escape returns to selection without downloading. Escape during an active lookup or download cancels that operation. Failed downloads retain their catalog record for retry through the editor's download action. A failed or cancelled refresh leaves the previous verified copy usable.

## Choose artifacts

In the review, select **Artifacts** and press Enter. The list comes from the provider; NCBI currently offers genome sequence (FASTA) and genome annotation (GFF3). All declared artifacts start checked. Use ↑/↓ to select a row and Space to check or uncheck it; Enter applies the selection, while Escape keeps the previous selection.

Only checked artifacts are requested. An unchecked artifact already verified in the cache is retained, not deleted. FASTA and GFF3 can be downloaded independently; an annotation-only entry cannot be opened as a genome until FASTA is present. A workflow still requires the files for its input role, regardless of the catalog download selection. If nothing is checked, use **Save metadata only** instead of downloading.

If a pinned FASTA changes during a sequence-only refresh, GenoPilot refuses to combine it with an older annotation; refresh both artifacts together.

## Download progress

During a download, the review shows received bytes and, when the provider supplies a transfer size, a progress bar and total. Otherwise the total is marked unavailable rather than guessed. Extraction, file/checksum verification, and publication have separate progress stages; finishing the transfer alone does not mean the genome is ready.

Successful downloads are verified, rescanned, and selected. Press `v` to inspect a verified copy when the browser is available. If requested annotation is unavailable, any verified FASTA remains usable for roles that do not require GFF3. An annotation-only request with no available GFF3 keeps its metadata but publishes no empty cache. A network or annotation request failure is not reported as absent annotation.

Enter edits the selected entry's local name and description. Its **Download / refresh** action downloads directly without saving or discarding unsaved labels. PageUp/PageDown scrolls metadata and local copies while fields and action buttons remain visible. The editor also offers **Refresh metadata** when the provider supports lookup; `m` activates it outside text fields. Refresh keeps unsaved labels, failures remain retryable, and Escape cancels an active lookup. On the list, `r` rescans caches. `d` confirms removal of the entry and its copies under known roots. Entries from different providers remain separate even when their identifiers match.

## Reuse in a workflow

Workflow inputs save the provider, pinned identifier, parameters, and an explicit `reuse` or `refresh` cache decision. Reuse snapshots a catalog copy only when it contains every file required by that input role. Copies in another output root can be reused without downloading; the resolver rechecks their required checksums and keeps refresh and deletion excluded until copying finishes. An uncached entry downloads on demand. Refresh downloads to the run's output root, leaving any cross-root copy unchanged.

Direct Snakemake execution uses the same packaged Node downloader, without the TUI or the Datasets CLI. Node must be on PATH, or `GENOPILOT_NODE_EXECUTABLE` must name its absolute executable path. Managed execution supplies that path automatically. Reused and newly downloaded inputs remain `imported`; provenance records the provider reference, facts, checksums, and whether a download occurred. Missing required annotation blocks only roles that need it.

Saved workflow configurations now use schema 2. Older configurations are rejected without migration; create a new run.

## Provider settings

**Manage tooling → Accession Providers** lists registered providers and their setup status. The download form has no Provider access section or optional-key notice. Only missing required credentials show a warning alert and a **Configure provider** action. NCBI's optional key is managed through Manage tooling; the catalog list has no provider-configuration shortcut. Escape returns through the provider list to the catalog, preserving its selection and draft. Returning rechecks settings but never starts a download automatically.

Secrets are masked, stored privately on this machine, and never prefilled. Type a replacement and select **Save settings**. Ctrl+X explicitly clears the selected field's stored secret; Ctrl+U clears its draft. Clearing credentials never deletes cached genomes.

Catalog status messages use info alerts; cautions such as unavailable annotation use warning alerts. NCBI's API key is optional: its absence does not block remote operations. A provider's required credentials block remote operations only; saved entries and verified local copies remain available. **Configured** means a value is stored, not that the service has verified it.

Incompatible catalogs are rejected without being overwritten. There is no migration.
