# Find and replace in GFF3

Renames identifiers and other attribute values in a GFF3 file, such as a transferred annotation whose IDs are still the reference's. It never changes the source file and never runs a workflow.

Open it from the home screen for any GFF3 file, or press `g` on a finished run's result page to choose one of the run's GFF3 files.

## Sequence IDs stay unchanged

Column 1 of a GFF3 names the sequence each feature lies on. It must match a FASTA header up to the first space, so genome browsers, validators, and repositories can place the feature. The replacement therefore never touches column 1, only attribute values in column 9.

For example, with the search `chr` and the replacement `contig`:

```text
chr1  .  gene  1  900  .  +  .  ID=chr1_g1;Name=chr1_g1
```

becomes

```text
chr1  .  gene  1  900  .  +  .  ID=contig1_g1;Name=contig1_g1;Alias=chr1_g1
```

`chr1` in column 1 still matches `>chr1` in the FASTA.

## Search and replacement

The search is exact text and case-sensitive, and every occurrence is replaced; the replacement is inserted as typed, so `$` has no special meaning. With **Regular expression**, the search uses JavaScript's syntax and the replacement may use `$1` for a captured group: `^AN(.*)` with `ANID_$1` turns `AN0001` into `ANID_0001`. A pattern that matches the empty string inside a value, such as `x*`, is rejected.

Values are compared after decoding GFF3's escapes, such as `%2C` for a comma. Changed values are written with GFF3's escaping, so a `,` in the replacement never splits a value; unchanged values keep their exact bytes.

## Attributes searched

Choose the attributes the replacement applies to. **IDs and references** covers `ID`, `Parent`, and `Derives_from` together, so features stay linked. The default adds `Name` and `locus_tag`. Others, such as `product` or `Dbxref`, are searched only when chosen; **All attributes** searches every attribute without guard rails.

A renamed `gene` or `pseudogene` keeps its former ID: it is added to its `Alias` after any aliases already there, unless it is among them. Earlier aliases are only searched when `Alias` or **All attributes** is chosen, so repeated rewrites keep a gene's history.

## Preview and checks

**Preview** reads the file and shows the number of replacements, the changed values per attribute with an example, how many IDs changed, matched without changing, or did not match, and the aliases it adds. Changing any field needs a new preview. **Write rewrite** then writes exactly what the preview showed; it refuses when the file changed since.

Nothing is written when a value becomes empty, a new ID is empty or contains whitespace, two IDs become one, a reference no longer names an ID, or a feature line does not have nine columns. References that already named no ID in the source are counted, not rejected. Esc cancels a running preview or rewrite.

## Output

Each rewrite writes a new folder named `gff3-replace-` with the time it was written, and never replaces an earlier one:

| File | Content |
|---|---|
| The GFF3 | The rewritten file, with the source's name. |
| `id-mapping.tsv` | One row per changed ID: the old and new ID, the feature type, the sequence, and the start of its first line. |
| `replace.yaml` | The source path and checksum, the search, the replacement, the attributes, the GenoPilot version, the checksums of both files, and the statistics. |

For a file of a run, including an earlier rewrite, the folder goes to the run's `derived/` folder, and the run's result page lists it under **Derived files**. Any other file gets a folder next to it, or in a folder chosen with Enter. A failed or cancelled rewrite leaves no folder.
