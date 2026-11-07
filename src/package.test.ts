import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("the packed package, its declarations and its aclp bin work in an independent consumer", async () => {
  const consumer = await mkdtemp(join(tmpdir(), "aclp-consumer-"));

  try {
    execFileSync("pnpm", ["pack", "--pack-destination", consumer], {
      encoding: "utf8",
      stdio: "pipe",
    });

    const tarball = (await readdir(consumer)).find((file) =>
      file.endsWith(".tgz"),
    );

    assert.ok(tarball, "pnpm pack must create a package archive");

    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "aclp-consumer-proof",
        private: true,
        type: "module",
      }),
    );
    execFileSync(
      "pnpm",
      [
        "add",
        "--offline",
        "--ignore-scripts",
        "--save-exact",
        join(consumer, tarball),
        "@types/node@26.6.6",
      ],
      { cwd: consumer, encoding: "utf8", stdio: "pipe" },
    );

    const source = `import { createClient, createServer, defineResult, type EventParams } from "@superaligned/aclp";
import { once } from "node:events";

const result = defineResult<{ context: string[] }>({
  type: "object", properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"], additionalProperties: false,
});

const server = createServer({ "input.submitted": { result, handle: () => ({ context: ["packed"] }) } });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Missing test address");
const client = createClient({ url: "http://127.0.0.1:" + address.port + "/events" });
const params: EventParams<"input.submitted"> = { sessionId: "consumer", content: [{ type: "text", text: "hello" }] };
try {
  const answer = await client.request("input.submitted", params, result);
  if (answer.context[0] !== "packed") throw new Error("Invalid packed reply");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
`;

    await writeFile(join(consumer, "consumer.ts"), source);
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          types: ["node"],
        },
        include: ["consumer.ts"],
      }),
    );

    execFileSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/typescript/bin/tsc"),
        "--project",
        join(consumer, "tsconfig.json"),
      ],
      { cwd: consumer, encoding: "utf8", stdio: "pipe" },
    );
    execFileSync(process.execPath, [join(consumer, "consumer.ts")], {
      cwd: consumer,
      encoding: "utf8",
      stdio: "pipe",
    });

    const help = execFileSync(
      process.execPath,
      [
        join(consumer, "node_modules/@superaligned/aclp/dist/bin/aclp.js"),
        "--help",
      ],
      { cwd: consumer, encoding: "utf8", stdio: "pipe" },
    );

    assert.match(help, /aclp install/);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});
