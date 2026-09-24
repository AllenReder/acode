import { assert, it } from "@effect/vitest";

import { formatCliCommand } from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    ["/home/theo/.npm/_npx/abc123/node_modules/awen/dist/bin.mjs", "npx awen serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\awen\\dist\\bin.mjs",
      "npx awen serve",
    ],
    ["/home/theo/.cache/pnpm/dlx/abc/node_modules/awen/dist/bin.mjs", "pnpm dlx awen serve"],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/awen/dist/bin.mjs",
      "pnpm dlx awen serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\awen\\dist\\bin.mjs",
      "pnpm dlx awen serve",
    ],
    ["/home/theo/.bun/install/cache/awen@0.0.31/dist/bin.mjs", "bunx awen serve"],
    ["/tmp/bunx-1000-awen@latest/node_modules/awen/dist/bin.mjs", "bunx awen serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-awen@latest\\node_modules\\awen\\dist\\bin.mjs",
      "bunx awen serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/awen/dist/bin.mjs",
    "/home/theo/Code/work/awen/apps/server/dist/bin.mjs",
    "/home/theo/.awen/runtime/0.0.31/node_modules/awen/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "awen serve",
    );
  }
});

it("uses one package spec for stable and prerelease versions", () => {
  for (const [version, expected] of [
    ["0.1.0-alpha.1", "npx awen serve"],
    ["0.0.31-nightly.20260729", "npx awen serve"],
    ["0.0.31-preview.20260729.1", "npx awen serve"],
    ["0.0.31-foo-preview.20260729.1", "npx awen serve"],
    ["0.0.31", "npx awen serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/awen/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/awen/dist/bin.mjs",
      version: "0.1.0-alpha.1",
    }),
    "npx awen serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-awen@latest/node_modules/awen/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx awen serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/awen/dist/bin.mjs",
      version: "0.1.0-alpha.1",
    }),
    "awen serve",
  );
});
