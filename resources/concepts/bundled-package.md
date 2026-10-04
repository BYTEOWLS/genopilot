# Bundled package

## Goal

Publish GenoPilot as a small npm package whose code is exactly what was built and tested: every JavaScript dependency, transitive ones included, at the version `pnpm-lock.yaml` pins, and nothing a user's install can resolve differently.

## Why

Today `dist/` is the TypeScript output file by file, and `ink`, `@inkjs/ui`, `react`, and `yaml` are runtime dependencies. A user's npm install resolves them anew:

- **Unpinned transitive versions.** `package.json` pins only the direct dependencies, and npm does not read `pnpm-lock.yaml`. The 40 transitive packages, such as `es-toolkit` and `ws`, resolve to whatever matches at install time, so two users can run different code under Ink. The scientific results are unaffected, because workflows run in pinned environments, but the application itself is not reproducible.
- **Size.** The production dependencies take about 25 MB in 44 packages, 18 MB of it `es-toolkit`, of which Ink uses a few functions. The [genome view](browser-view/genome.md)'s full IGV development package is about 19 MB, but a trial browser bundle of its ESM entry is about 1.5 MB. Keep the full development package and let release bundling include the imported code rather than installing or copying the entire distribution.

Large Ink applications publish a bundle for the same reasons: the Gemini CLI publishes `bundle/gemini.js` without runtime dependencies, and Claude Code published one `cli.js` with none.

An `npm-shrinkwrap.json` would pin the transitive versions too, but it keeps the size, is a second lockfile beside pnpm's, and has to be generated with npm in a pnpm repository.

## Design

esbuild bundles `src/cli.tsx` and everything it imports into one ES module, `dist/cli.js`. The package then has no `dependencies`: `ink`, `@inkjs/ui`, `react`, and `yaml` move to `devDependencies`, and esbuild is added there at an exact version. What is bundled is what `pnpm-lock.yaml` installed.

The package contains:

- `dist/cli.js`, the bundle, keeping the entry's `#!/usr/bin/env node`;
- locally bundled [browser view](browser-view/README.md) assets, including IGV loaded only for genome views, and `dist/vendor/` only for any files that genuinely need serving unchanged;
- `THIRD-PARTY-LICENSES.md`, see below;
- `workflows/`, `docs/`, `runtime/pixi.toml`, `runtime/pixi.lock`, `CHANGELOG.md`, and `README.md`, as today.

### Build

`pnpm build` runs, in order:

1. `tsc --noEmit`, so type errors still fail the build; esbuild only strips types.
2. esbuild with `--bundle --platform=node --format=esm --target=node24`, and:
   - React built for production (`process.env.NODE_ENV` defined as `"production"`), which drops React's development builds;
   - `react-devtools-core` aliased to an empty module. Ink loads its devtools module on demand, only when `DEV=true`, and that module imports `react-devtools-core`, an optional package that is not installed. esbuild inlines Ink's devtools module, so the import of the missing package becomes a top-level import of the bundle, which then fails to start;
   - a banner defining `require` through `createRequire(import.meta.url)`, for bundled CommonJS code that requires Node built-ins from an ES module;
   - a metafile, which the next step reads.
3. The browser build bundles its imports and their used transitive code into local assets, with IGV loaded separately for genome views. Prefer IGV's ESM `module` entry over its non-ESM `browser` entry (`mainFields: ['module', 'browser', 'main']` was verified). No special extraction of its published minified file is needed.
4. A small Node script that copies any necessary unchanged vendor files and writes `THIRD-PARTY-LICENSES.md` from both build metafiles.

One npm package delivers both the CLI bundle and browser assets; Node and browser code cannot share one executable bundle. Shrinking means excluding unused distribution files and bundling the imported code, not assuming every library's internal features can be tree-shaken away.

The bundle is not minified: about 1.8 MB instead of 0.8 MB, in exchange for stack traces with real function names in bug reports.

Tests keep running on the sources with `tsx`, so the bundle changes nothing for them. `pnpm dev` and `pnpm dev:watch` stay as they are.

### Packaged resources

Seven modules find packaged files relative to their own position in `dist/`, such as `new URL('../../runtime/', import.meta.url)`. In the bundle every module is `dist/cli.js`, so these paths point outside the package. A trial bundle showed this: `genopilot update` worked, Ink rendered, and the welcome screen then failed to read `runtime/pixi.lock`.

One module resolves the package root once, from its own location, and the others ask it for the packaged directory they need:

- `src/cli.tsx` (`package.json`);
- `src/tooling/paths.ts` (`runtime/`);
- `src/workflows/discovery.ts` (`workflows/`);
- `src/workflows/execution.ts` (`workflows/shared/logging`);
- `src/docs/documents.ts` (`docs/`);
- the two run-configuration screens (each workflow's Snakefile), which should come from the discovered manifest's directory instead.

The root is the same in the sources (`src/` run through `tsx`) and in the bundle (`dist/cli.js`): one directory up from the module. This is also what the rule to resolve packaged resources relative to the installed application asks for. The other modules then need only that one helper.

### Licenses

Bundling copies third-party code into GenoPilot's own file, so the package must carry the dependencies' license notices itself; the dependency packages and their `LICENSE` files are no longer installed. esbuild's own collection (`--legal-comments`) finds only code with `@license` comments, which most MIT packages lack. The build script therefore lists every package in the metafile's inputs and writes each one's name, version, license, and `LICENSE` file into `THIRD-PARTY-LICENSES.md`. A package without a license file, or with a license other than an allowed permissive one (MIT, ISC, BSD, Apache-2.0), fails the build.

### Verification

- Every `pnpm pack:local` packs the bundle and the license file.
- The open task to verify the packed CLI in a clean temporary installation runs the bundle from that install: it starts, reads the packaged manifests, docs, and runtime lock, and has no `node_modules` of its own.
- A test checks that `package.json` lists no `dependencies`, so a runtime dependency added later fails until it is bundled or deliberately allowed.

## Out of scope

- Native binaries or single-executable applications: users install Node anyway.
- Bundling the workflows' Python or the Pixi runtime; they stay packaged files.

## Work

1. One package-root helper replaces the seven module-relative paths, with tests in the sources.
2. The CLI and browser esbuild builds, any necessary vendor copy, and `THIRD-PARTY-LICENSES.md`; dependencies move to `devDependencies`; `package.json` `files` updated. Verify the packed browser uses only the needed IGV bundle and includes its license, not its full development distribution.
3. The no-dependencies test and the clean-installation check of the packed CLI.
4. `README.md` (build and packaging) and `CHANGELOG.md`.
