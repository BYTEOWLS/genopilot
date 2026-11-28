# Guided installation and first-run setup

## Outcome

Researchers can install GenoPilot and configure optional provider access through a guided setup, without manually finding each settings page.

## Scope and contract

- Explore a convenience installer inspired by https://pi.dev/install.sh: check Node/npm compatibility, install an explicit GenoPilot release, detect existing installations, and explain PATH fixes. Node remains manually installed; show instructions when it is missing or incompatible.
- Keep npm installation supported independently. GenoPilot already bundles its npm dependencies; an installer is for convenience, not an additional dependency-pinning guarantee. Disable npm installation hooks and retain frozen-lockfile builds.
- Offer skippable, repeatable first-run setup inside GenoPilot. Reuse existing tooling checks, consent-based verified Pixi setup, provider declarations, settings forms, and private credential storage rather than collecting secrets in a shell script.
- Ask whether the researcher wants to use VEuPathDB. If yes, show the existing account/key instructions and allow masked API-key entry directly in setup. Skipping must leave local use and other providers available; offer the optional NCBI key through the same provider-driven flow.
- Never put keys in command arguments, URLs, shell history, logs, run configuration, or exports. Preserve existing credentials unless explicitly replaced or cleared. Distinguish a stored key from service-verified access.
- Keep setup independent of scientific run configuration. Show a final summary of installed, configured, skipped, and unresolved items; do not start downloads or workflows automatically.

## Acceptance criteria

- [ ] Installation checks supported Node/npm requirements, handles existing installations without silently replacing unrelated executables, and explains PATH changes before applying them.
- [ ] Normal npm installation remains usable without the convenience installer or interactive setup.
- [ ] Researchers can accept, skip, cancel, and later reopen setup without losing existing settings or implying incomplete tooling is ready.
- [ ] Opting into VEuPathDB allows direct masked key entry using existing provider settings and links to key-creation instructions; opting out requires no key.
- [ ] Secrets stay in existing private credential storage and are absent from installer output, logs, commands, and run artifacts.
- [ ] Runtime provisioning requires explicit consent; failures and cancellation preserve working installations and offer a clear retry path.
- [ ] A final summary distinguishes configured credentials from verified access and provides next steps for missing prerequisites.
