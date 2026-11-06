# Repository rules

- Keep this one ESM package. Protocol definitions belong in `superaligned-to/aclp`.
- Generate protocol types from the pinned schema; do not edit generated definitions by hand.
- Use `.ts` relative imports and explicit public types. Avoid `any`, unchecked casts and non-null assertions.
- Keep callbacks application-neutral. Authentication uses configured HTTP credentials; OAuth and harness adapters are outside this first SDK.
- Run `pnpm check` before committing. Keep tests beside the behavior they cover.
- Use one-line conventional commits.
- Keep the dependency and module-size guards current. Preserve blank lines between logical blocks.
