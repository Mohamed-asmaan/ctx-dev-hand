// tests/unit/readers/platform.test.ts
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { readPlatform } from "../../../src/readers/platform.js";

const COMPOSE_FIXTURES = path.resolve("tests/fixtures/compose");

async function withCompose(fixtureName: string, fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-platform-"));
  try {
    await fs.copyFile(
      path.join(COMPOSE_FIXTURES, fixtureName),
      path.join(dir, "docker-compose.yml"),
    );
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("readPlatform", () => {
  it("single-db.yml → postgres 9.6 with correct line number", async () => {
    await withCompose("single-db.yml", async (dir) => {
      const p = await readPlatform(dir);
      expect(p.database?.engine).toBe("postgres");
      expect(p.database?.version).toBe("9.6");
      expect(p.database?.declaredIn).toMatch(/docker-compose\.yml:\d+/);
      // Assert the line number is exact (image is on line 3 of single-db.yml)
      expect(p.database?.declaredIn).toBe("docker-compose.yml:3");
    });
  });

  it("declaredIn line number is exact (not just present)", async () => {
    await withCompose("single-db.yml", async (dir) => {
      const p = await readPlatform(dir);
      const [, lineStr] = (p.database?.declaredIn ?? "").split(":");
      const lineNum = parseInt(lineStr, 10);
      expect(lineNum).toBeGreaterThan(0);
      expect(Number.isNaN(lineNum)).toBe(false);
    });
  });

  it("two-dbs.yml → both returned in allFound", async () => {
    await withCompose("two-dbs.yml", async (dir) => {
      const p = await readPlatform(dir);
      expect(p.database?.allFound.length).toBeGreaterThanOrEqual(2);
      const engines = p.database!.allFound.map((e) => e.engine);
      expect(engines).toContain("postgres");
    });
  });

  it("no-db.yml → database null with reason", async () => {
    await withCompose("no-db.yml", async (dir) => {
      const p = await readPlatform(dir);
      expect(p.database?.engine).toBeNull();
    });
  });

  it("unpinned.yml → version 'latest'", async () => {
    await withCompose("unpinned.yml", async (dir) => {
      const p = await readPlatform(dir);
      expect(p.database?.version).toBe("latest");
    });
  });

  it("digest-pinned.yml → version extracted without sha256 noise", async () => {
    await withCompose("digest-pinned.yml", async (dir) => {
      // The image is postgres@sha256:... — no colon-tag, so extractVersion returns "latest"
      const p = await readPlatform(dir);
      expect(p.database?.engine).toBe("postgres");
      // version should not include "sha256" or "@"
      expect(p.database?.version).not.toContain("sha256");
    });
  });

  it(".ctx/config.json present → overrides compose (precedence)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-cfg-"));
    try {
      // Write compose with postgres:9.6
      await fs.copyFile(
        path.join(COMPOSE_FIXTURES, "single-db.yml"),
        path.join(dir, "docker-compose.yml"),
      );
      // Write .ctx/config.json overriding with postgres 14
      await fs.mkdir(path.join(dir, ".ctx"), { recursive: true });
      await fs.writeFile(
        path.join(dir, ".ctx", "config.json"),
        JSON.stringify({
          platform: {
            database: {
              engine: "postgres",
              version: "14",
              declaredIn: ".ctx/config.json",
              confidence: "declared",
              allFound: [],
            },
          },
        }),
      );
      const p = await readPlatform(dir);
      expect(p.database?.version).toBe("14");
      expect(p.database?.declaredIn).toContain("config.json");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("both docker-compose.yml and docker-compose.yaml → .yml used, warning emitted", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-both-"));
    try {
      await fs.copyFile(
        path.join(COMPOSE_FIXTURES, "single-db.yml"),
        path.join(dir, "docker-compose.yml"),
      );
      await fs.copyFile(
        path.join(COMPOSE_FIXTURES, "two-dbs.yml"),
        path.join(dir, "docker-compose.yaml"),
      );
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const p = await readPlatform(dir);
      expect(p.database?.version).toBe("9.6"); // from .yml, not .yaml
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("docker-compose.yaml"));
      stderrSpy.mockRestore();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("invalid YAML → returns database null, does not throw", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-badyaml-"));
    try {
      await fs.writeFile(path.join(dir, "docker-compose.yml"), "services:\n  db:\n  : {bad yaml{{{");
      const p = await readPlatform(dir);
      expect(p.database?.engine).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
