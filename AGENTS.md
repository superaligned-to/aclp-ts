# Repository rules

- Keep one ESM package, `@superaligned/aclp`: the SDK in `src/` (exported at `.`), the harness tooling in `src/hooks/` (exported at `./hooks` and `./runtime`), and the `aclp` and `aclp-hook` bins. Protocol definitions belong in `superaligned-to/aclp`.
- Generate protocol types from the pinned schema; do not edit generated definitions by hand.
- Runtime dependencies are the SDK's validators only. `scripts/bundle.ts` bundles the bins and plugin runtime into `dist/bin` with `@clack/prompts` inlined; the guard rejects bare imports there, because that directory is copied to `~/.config/aclp/runtime`.
- Hooks code imports the SDK from local source, never from the package name.
- One adapter module per harness in `src/hooks/adapters/<harness>.ts`; in-process plugin code lives in `src/hooks/adapters/<harness>-runtime.ts`. Record each adapter's support level honestly: `lifecycle`, `observe` or `mcp`. Verify native formats against the harness's primary docs and add a case to `src/hooks/adapters/fixtures/events.json` for every new native event.
- Hook commands run the copied runtime, never `npx`. Never write credentials into harness configuration. Installs show their plan, are idempotent, keep users' own hooks and uninstall cleanly.
- Keep callbacks application-neutral. Authentication uses configured HTTP credentials; OAuth flows and harness adapters live in `src/hooks`, not in the SDK.
- Use `.ts` relative imports and explicit public types. Avoid `any`, unchecked casts and non-null assertions.
- Run `pnpm check` before committing. Keep tests beside the behavior they cover.
- Use one-line conventional commits.
- Keep the dependency and module-size guards current. Preserve blank lines between logical blocks.
