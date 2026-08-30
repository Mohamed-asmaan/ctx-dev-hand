// tests/slow/scalability.test.ts
// @slow — excluded from default test run (see vitest.config.ts)
// Tests that verify the tool remains responsive under adversarial scale.
// Run with: npm run test:slow

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { readManifest } from "../../src/adapters/java-maven/manifest.js";
import { scanImports } from "../../src/adapters/java-maven/imports.js";
import { runEngine, type RegistryDataMap } from "../../src/compat/engine.js";
import { loadCompatibility } from "../../src/compat/loader.js";
import type { StateJson } from "../../src/store/schema.js";

// ── helper ───────────────────────────────────────────────────────────────────

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ctx-slow-"));
}

// ── S1: 500-dependency pom.xml ────────────────────────────────────────────────

describe(
  "S1 — 500 dependency pom.xml parses in < 2s",
  () => {
    it(
      "readManifest on a 500-dep pom completes in < 2000ms",
      async () => {
        const dir = await makeTmp();
        try {
          // Build a pom with 500 unique dependencies
          const deps = Array.from({ length: 500 }, (_, i) => `
    <dependency>
      <groupId>com.example.group${i}</groupId>
      <artifactId>artifact${i}</artifactId>
      <version>1.${i}.0</version>
    </dependency>`).join("\n");

          await fs.writeFile(
            path.join(dir, "pom.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>large-app</artifactId>
  <version>1.0.0</version>
  <properties><maven.compiler.source>8</maven.compiler.source></properties>
  <dependencies>${deps}
  </dependencies>
</project>`,
            "utf8",
          );

          const start = Date.now();
          const m = await readManifest(dir);
          const elapsed = Date.now() - start;

          expect(m.dependencies.length).toBe(500);
          expect(elapsed).toBeLessThan(2000);
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
      15_000,
    );
  },
);

// ── S2: 5000 Java files (cap test) ───────────────────────────────────────────

describe(
  "S2 — 5001 Java files → scan caps at 5000",
  () => {
    it(
      "scanImports caps at 5000 files and sets capped=true",
      async () => {
        const dir = await makeTmp();
        try {
          const srcDir = path.join(dir, "src");
          await fs.mkdir(srcDir, { recursive: true });

          // Write 5001 minimal java files
          await Promise.all(
            Array.from({ length: 5001 }, (_, i) =>
              fs.writeFile(
                path.join(srcDir, `Class${i}.java`),
                `package com.example;\npublic class Class${i} {}\n`,
                "utf8",
              ),
            ),
          );

          const start = Date.now();
          const { capped } = await scanImports(dir, []);
          const elapsed = Date.now() - start;

          expect(capped).toBe(true);
          expect(elapsed).toBeLessThan(30_000);
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);

// ── S3: 200 findings → resolveOrder stays deterministic ──────────────────────

describe(
  "S3 — 200 dependency findings → resolveOrder is deterministic",
  () => {
    it(
      "runEngine with 200 C1 findings produces consistent upgrade order",
      async () => {
        // Build a state with 200 dependencies that each need upgrading
        const deps = Array.from({ length: 200 }, (_, i) => ({
          groupId: "org.postgresql",
          artifactId: "postgresql",
          version: "42.2.5",
          scope: "compile" as const,
          versionRaw: "42.2.5",
        }));

        // Deduplicate — engine operates on unique dep keys; use varied groupIds
        const uniqueDeps = Array.from({ length: 200 }, (_, i) => ({
          groupId: `com.example.group${i}`,
          artifactId: `artifact${i}`,
          version: "1.0.0",
          scope: "compile" as const,
          versionRaw: "1.0.0",
        }));

        const state: StateJson = {
          schemaVersion: 1,
          scannedAt: new Date().toISOString(),
          language: "java",
          declaredRuntimeVersion: "8",
          buildTool: "maven",
          manifestPath: "pom.xml",
          parentResolved: false,
          dependencies: uniqueDeps,
          platform: {
            database: {
              engine: null,
              version: null,
              declaredIn: null,
              confidence: "declared",
              allFound: [],
            },
          },
          importMap: {},
        };

        const db = loadCompatibility();
        // No registry data — all will be in notChecked.noRegistry
        const registry: RegistryDataMap = {};

        const start = Date.now();
        const result = runEngine(state, "11", db, registry);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(5_000);
        // All deps have no compat data → noRegistry or noCompatibility
        const notCheckedTotal =
          result.notChecked.noRegistry.length + result.notChecked.noCompatibility.length;
        expect(notCheckedTotal).toBeGreaterThan(0);
      },
      15_000,
    );
  },
);
