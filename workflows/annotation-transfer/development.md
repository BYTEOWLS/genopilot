# Annotation transfer: maintainer notes

## Updating LiftOn

A LiftOn update changes the pin in the [`lifton`](envs/lifton/environment.yaml) environment, and additionally requires re-verifying everything that depends on the exact files and values LiftOn writes. Check the release notes and the LiftOn source for the new version, then update any changed behavior in:

| File | Depends on |
|---|---|
| `workflows/annotation-transfer/rules/transfer_annotation.smk` | Output layout; the declared `lifton_output/` directory must contain every file LiftOn writes (older releases wrote `liftoff/` and `miniprot/` beside it) |
| `workflows/annotation-transfer/scripts/collect_transfer_metrics.py` | Mutation classes that count as unchanged proteins |
| `workflows/annotation-transfer/results.md` | Gene `source`, transcript `status`, and mutation-class values explained on the result help page |
| `resources/concepts/done/annotation-transfer-results.md` | The documented metric and value contract |

Then run the full verification including the per-rule Conda integration tests, as described under *Updating a pinned version* in the repository README. Their expected coordinates on the synthetic fixtures detect changes in transfer results.
