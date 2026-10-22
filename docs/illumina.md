# Illumina

Currently only paired-end Illumina data is supported. This page explains its read files, chemistry, and processing settings. See [Managing isolates](isolates.md) for editing, library identity, and saving.

## Read pairs

Each pair groups an R1 and R2 FASTQ file from the same sequencing fragments. Files may be plain or gzip-compressed. Keep mates and lane/chunk groups together under the correct read set and library.

Add more pairs to an existing set when they belong to its library, or add another read set for another delivery or preparation. Files stay in their original locations. Archive-renamed reads may be entered manually with confirmed library identity; delivery-pattern discovery is only an import convenience. See [Import review](import-review.md) for delivery import and copy selection.

## Chemistry

Illumina uses sequencing by synthesis (SBS): DNA bases are incorporated and identified from fluorescent images. The chemistry determines how those signals distinguish A, C, G, and T.

Labs usually choose an instrument and sequencing service, rather than choosing a detection scheme independently. Throughput, cost, read length, available equipment, and turnaround influence that choice; the instrument determines which chemistries it supports.

Choose the detection scheme confirmed by the sequencing provider. Instrument families below are examples, not a substitute for checking the exact model; ordinary FASTQ filenames do not establish chemistry.

| Option | Meaning and common examples | Poly-G Auto |
|---|---|---|
| `four-colour` | Four fluorescent channels distinguish the bases; classic MiSeq and older HiSeq systems | Off |
| `two-colour` | Two channels distinguish the bases; NextSeq and NovaSeq systems. G is the dark state, so signal loss can produce artificial poly-G tails | On |
| `one-channel` | One channel with two imaging steps; iSeq 100 | No validated default; choose On or Off explicitly when trimming will run |
| `unknown` | The detection scheme has not been confirmed | Choose On or Off explicitly when trimming will run |

**Why poly-G matters:** a poly-G tail is a stretch of G bases near a read's end. On two-colour systems, loss of fluorescence can be interpreted as G, creating an artificial tail. Trimming targets this artefact; it does not mean every stretch of G is an error, and fewer missing consensus bases alone does not prove better preprocessing.

These options describe detection schemes, not every chemistry revision. Do not classify one-channel as four-colour merely because it is not two-colour. Its Auto default has not been validated here, which is not a claim that it cannot produce poly-G artefacts.

Use `unknown` when the scheme is unconfirmed, not as a judgement that the reads are poor. Ask the provider for the instrument model or consult run metadata. One-channel and unknown may be saved in the catalog, but need an explicit poly-G choice before untrimmed reads can run.

## Processing metadata

| Setting | Meaning |
|---|---|
| Chemistry | Use the chemistry options above, confirmed from the provider's instrument information |
| Poly-G Auto | On for two-colour, Off for four-colour; one-channel and unknown require an explicit On/Off choice when trimming will run |
| Poly-G On / Off | Explicit choice recorded with the read set's effective settings |
| Provider trimmed: yes | The file group was already trimmed or filtered; further trimming is skipped |
| Provider trimmed: no | The group is confirmed unprocessed |
| Provider trimmed: unknown | Review before execution; unknown is not silently treated as unprocessed |

After import, review these settings in Edit isolate before running untrimmed read sets. The workflow's documentation explains its remaining preprocessing settings and scientific limits.
