# Managing isolates

An isolate is a biological sample. Its read sets describe sequencing data from that sample; adding another delivery or library does not require another isolate. Technique-specific settings have their own Help tabs, currently [Illumina](illumina.md).

## Isolate list

| Key | Action |
|---|---|
| ↑/↓ | Select an isolate |
| Enter | Edit the selected isolate |
| `n` | Add an isolate manually |
| `i` | Import a sequencing delivery |
| `d` | Request removal; confirm with `y` |
| `r` | Reload the catalog |
| `?` | Open this help |
| Esc | Return to the previous screen |

The list groups isolates by the sequencing technique recorded on their read sets. Each heading shows the isolate count, not the number of read sets; each isolate appears once. Group headings stay visible while scrolling and are not selectable.

An empty catalog shows a warning alert with the manual-add and import actions.

Rows show read-pair counts and processing state. A wild-type badge appears only when true. Successful file checks have no badge; pending checks, file problems, and recorded parent lineage remain visible.

Removing an isolate removes its catalog entry, not its sequencing files. An isolate with recorded descendants cannot be removed until their parent links are changed.

## Editing

The form separates isolate details and each read set with borderless headings and spacing, like accession details. Within a read set, each pair has its own indented section for its files, previous processing, and removal. Long forms keep the current read-set and pair headings visible while scrolling and resizing.

| Field | Meaning |
|---|---|
| Technique | Read-only sequencing technique, shown once in isolate details |
| Name | Editable display name |
| ID | Stable isolate identity; chosen when creating the isolate and fixed afterwards |
| Description | Optional local notes |
| Wild type | True, false, or unknown; never inferred from sequencing data |
| Derived from | Optional parent isolate from the catalog |

Tab, Shift+Tab, and ↑/↓ move between fields. Space and ←/→ change choices. Enter activates a selected button or opens the file chooser on a path field; it never submits a text field.

Action buttons are enclosed in `[ ]`. Read-set buttons have space above and below them; the add-set button is labelled **Add paired set**. Select the save button and press Enter to validate and save. Problems leave the draft open; long lists show a short preview so controls remain visible. Esc leaves without saving.

On a choice or button, press `?` for help. In a text or path field, `?` is ordinary input. Tab or ←/→ switches between general help and technique tabs. Esc or `?` closes help and restores the current draft and selection.

## Read sets and library identity

A read set represents one library, platform, and read layout and can contain multiple file groups across lanes or chunks. Each set has a stable ID, independent of its editable name and file paths. File layouts and processing settings are explained in the technique's own Help tab.

A library is one physical DNA preparation. Its ID tells duplicate marking which reads belong together across lanes or sequencing runs. Different preparations need different IDs, even when they come from the same isolate.

New sets receive an editable suggestion such as `sample-a-library-1`, avoiding existing IDs under that isolate. Review it before saving: names and read headers do not prove library identity. For a top-up of the same physical library, use that library's existing ID. Saving confirms the reviewed value.

## Runs and saved changes

Runs explicitly select read sets. The chooser suppresses repeated names and UUIDs, distinguishes equally named sets, and shows incompatibility reasons for the highlighted row. Unreviewed processing or incomplete technique metadata can block selection without making the catalog entry invalid.

Each run snapshots only its selected inputs and effective settings. Editing the catalog later does not change saved runs.

Saves refuse to overwrite concurrent catalog changes. If saving reports a conflict, keep a note of your draft, return to the list, reload, and review the latest entry before saving again. Read-file validation failures do not modify delivered files.
