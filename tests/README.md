# Snakemake workflow tests

Python tests for the reusable Snakemake rules and scripts under
`workflows/shared/` live alongside the TypeScript application tests in this
directory; see [`../AGENTS.md`](../AGENTS.md). The Python and TypeScript test
runners distinguish them by filename.

Rule scripts are dependency-free (standard library only), so tests run with
the system interpreter, no virtual environment required:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

Run from the package root (this directory's parent). Direct-Snakemake execution
tests (`test_snakefile_direct_execution.py` files) additionally require a
`snakemake` binary on `PATH` matching the version pinned in
`src/tooling/policy.ts`; they skip themselves otherwise rather than depending
on locally installed bioinformatics tooling to collect at all.
