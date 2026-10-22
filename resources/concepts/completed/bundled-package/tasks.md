# Bundled package — tasks

[Concept](concept.md). Steps affect this repository.

## Work

1. One package-root helper replaces the module-relative paths, with tests in the sources.
2. The CLI and browser esbuild builds, any necessary vendor copy, and `THIRD-PARTY-LICENSES.md`; dependencies move to `devDependencies`; `package.json` `files` updated. Verify the packed browser uses only the needed IGV bundle and includes its license, not its full development distribution.
3. The no-dependencies test and the clean-installation check of the packed CLI.
4. `README.md` (build and packaging) and `CHANGELOG.md`.
