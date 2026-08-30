// tests/unit/readers/imports.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { scanImports } from "../../../src/adapters/java-maven/imports.js";
import type { Dependency } from "../../../src/store/schema.js";

const JAVA_FIXTURES = path.resolve("tests/fixtures/java");

const PG_DEP: Dependency = {
  groupId: "org.postgresql",
  artifactId: "postgresql",
  version: "42.2.5",
  scope: "compile",
  versionRaw: "42.2.5",
};
const JAXB_DEP: Dependency = {
  groupId: "javax.xml.bind",
  artifactId: "jaxb-api",
  version: "2.3.0",
  scope: "compile",
  versionRaw: "2.3.0",
};

// Creates a temp dir with selected fixture java files
async function withJava(
  files: string[],
  deps: Dependency[],
  fn: (dir: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-imports-"));
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    for (const f of files) {
      await fs.copyFile(path.join(JAVA_FIXTURES, f), path.join(srcDir, f));
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("scanImports", () => {
  it("Connection.java → org.postgresql with correct line number", async () => {
    await withJava(["Connection.java"], [PG_DEP], async (dir) => {
      const r = await scanImports(dir, [PG_DEP]);
      expect(r.importMap["org.postgresql"]).toBeDefined();
      const entries = r.importMap["org.postgresql"];
      expect(entries.length).toBeGreaterThan(0);
      // Line numbers should be positive integers
      for (const entry of entries) {
        const lineNum = parseInt(entry.split(":").pop()!, 10);
        expect(lineNum).toBeGreaterThan(0);
      }
    });
  });

  it("static imports matched — import static org.postgresql.*.* is captured", async () => {
    await withJava(["Connection.java"], [PG_DEP], async (dir) => {
      const r = await scanImports(dir, [PG_DEP]);
      const entries = r.importMap["org.postgresql"];
      // Connection.java has both regular and static imports
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("wildcard imports matched — import org.postgresql.* is captured", async () => {
    await withJava(["Connection.java"], [PG_DEP], async (dir) => {
      const r = await scanImports(dir, [PG_DEP]);
      const entries = r.importMap["org.postgresql"];
      expect(entries.some((e) => e.includes("Connection.java"))).toBe(true);
      expect(entries.some((e) => e.endsWith(":9"))).toBe(true);
    });
  });

  it("commented-out import is NOT matched", async () => {
    await withJava(["XmlMapper.java"], [JAXB_DEP], async (dir) => {
      const r = await scanImports(dir, [JAXB_DEP]);
      const entries = r.importMap["javax.xml.bind"] ?? [];
      // XmlMapper.java has a commented-out import. All matched entries
      // should be real imports, not comments.
      // We check: total matches ≤ 3 (the 3 real imports in XmlMapper.java)
      expect(entries.length).toBeLessThanOrEqual(3);
    });
  });

  it("import inside a string literal is NOT matched", async () => {
    await withJava(["XmlMapper.java"], [JAXB_DEP], async (dir) => {
      const r = await scanImports(dir, [JAXB_DEP]);
      // XmlMapper has a string with import — must not be counted
      // We verify the count is exactly 3 (the 3 real imports)
      expect(r.importMap["javax.xml.bind"]).toHaveLength(3);
    });
  });

  it("NoImports.java → empty result for declared dep", async () => {
    await withJava(["NoImports.java"], [PG_DEP], async (dir) => {
      const r = await scanImports(dir, [PG_DEP]);
      expect(r.importMap["org.postgresql"] ?? []).toHaveLength(0);
    });
  });

  it("Unicode.java → parses without error", async () => {
    await withJava(["Unicode.java"], [PG_DEP], async (dir) => {
      const r = await scanImports(dir, [PG_DEP]);
      expect(r).toBeDefined();
      expect(r.capped).toBe(false);
    });
  });

  it("import matching no declared dependency → silently ignored", async () => {
    // Pass JAXB dep but only have Connection.java (pg imports)
    await withJava(["Connection.java"], [JAXB_DEP], async (dir) => {
      const r = await scanImports(dir, [JAXB_DEP]);
      // pg imports should NOT appear in the result
      expect(r.importMap["org.postgresql"]).toBeUndefined();
      // jaxb will have 0 entries (Connection.java has no jaxb imports)
      expect(r.importMap["javax.xml.bind"] ?? []).toHaveLength(0);
    });
  });

  it("file with CRLF line endings → line numbers still correct", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-crlf-"));
    try {
      const srcDir = path.join(dir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      // Write a CRLF version of Connection.java
      const content = "package db;\r\n\r\nimport org.postgresql.Driver;\r\n\r\npublic class Foo {}\r\n";
      await fs.writeFile(path.join(srcDir, "Foo.java"), content);
      const r = await scanImports(dir, [PG_DEP]);
      const entries = r.importMap["org.postgresql"] ?? [];
      expect(entries.length).toBeGreaterThan(0);
      const lineNum = parseInt(entries[0].split(":").pop()!, 10);
      expect(lineNum).toBe(3); // line 3 in CRLF file
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("5001 files present → caps at 5000, cap=true reported", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-cap-"));
    try {
      const srcDir = path.join(dir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      // Create 5001 minimal Java files
      const content = "package gen;\npublic class Gen{}\n";
      const creates = [];
      for (let i = 0; i < 5001; i++) {
        creates.push(fs.writeFile(path.join(srcDir, `Gen${i}.java`), content));
      }
      await Promise.all(creates);
      const r = await scanImports(dir, [PG_DEP]);
      expect(r.capped).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000); // allow extra time for file creation
});
