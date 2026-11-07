import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

// The bins and plugin runtime are copied to ~/.config/aclp/runtime, so they must not import anything outside dist/bin.
await build({
  entryPoints: [
    "src/hooks/aclp.ts",
    "src/hooks/aclp-hook.ts",
    "src/hooks/runtime.ts",
  ],
  outdir: "dist/bin",
  bundle: true,
  splitting: true,
  chunkNames: "chunk-[hash]",
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
});
