// tests/unit/edge-cases.test.ts
// One test per documented edge case E1–E20.
// Each test is self-contained: minimal fixture, clean assertion.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { readManifest } from "../../src/adapters/java-maven/manifest.js";
import { readPlatform } from "../../src/readers/platform.js";
import { scanImports } from "../../src/adapters/java-maven/imports.js";
import { fetchArtifact } from "../../src/adapters/java-maven/registry.js";
import { writeState, readState, CtxError } from "../../src/store/state.js";
import { cacheGet, cacheSet } from "../../src/store/cache.js";
import { runEngine, type RegistryDataMap } from "../../src/compat/engine.js";
import { loadCompatibility } from "../../src/compat/loader.js";
import type { StateJson } from "../../src/store/schema.js";

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ctx-e-"));
}

async function writePom(dir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, "pom.xml"), content, "utf8");
}

async function writeCompose(dir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, "docker-compose.yml"), content, "utf8");
}

const MINIMAL_STATE: StateJson = {
  schemaVersion: 1,
  scannedAt: new Date().toISOString(),
  language: "java",
  declaredRuntimeVersion: "8",
  buildTool: "maven",
  manifestPath: "pom.xml",
  parentResolved: false,
  dependencies: [],
  platform: { database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] } },
  importMap: {},
};

// ── E1: missing pom.xml ───────────────────────────────────────────────────────

describe("E1 — missing pom.xml", () => {
  it("readManifest throws CtxError E1 when pom.xml is absent", async () => {
    const dir = await makeTmp();
    try {
      await expect(readManifest(dir)).rejects.toMatchObject({ code: "E1" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E2: parent pom present ────────────────────────────────────────────────────

describe("E2 — parent pom", () => {
  it("pom with <parent> sets parentResolved = false (parent not fetched locally)", async () => {
    const dir = await makeTmp();
    try {
      await writePom(dir, `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.0</version>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <properties><maven.compiler.source>11</maven.compiler.source></properties>
  <dependencies></dependencies>
</project>`);
      const m = await readManifest(dir);
      // parentResolved = false means a <parent> was detected but not locally resolved
      expect(m.parentResolved).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E3: property interpolation ────────────────────────────────────────────────

describe("E3 — property interpolation", () => {
  it("resolves ${pg.version} from <properties>", async () => {
    const dir = await makeTmp();
    try {
      await writePom(dir, `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <properties>
    <pg.version>42.2.5</pg.version>
    <maven.compiler.source>8</maven.compiler.source>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <version>\${pg.version}</version>
    </dependency>
  </dependencies>
</project>`);
      const m = await readManifest(dir);
      const pg = m.dependencies.find((d) => d.artifactId === "postgresql");
      expect(pg?.version).toBe("42.2.5");
      expect(pg?.versionRaw).toBe("${pg.version}");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("unresolvable property → version is 'unresolved'", async () => {
    const dir = await makeTmp();
    try {
      await writePom(dir, `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.hibernate</groupId>
      <artifactId>hibernate-core</artifactId>
      <version>\${hibernate.version}</version>
    </dependency>
  </dependencies>
</project>`);
      const m = await readManifest(dir);
      const h = m.dependencies.find((d) => d.artifactId === "hibernate-core");
      expect(h?.version).toBe("unresolved");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E4: version ranges ────────────────────────────────────────────────────────

describe("E4 — version range", () => {
  it("range version → version = 'range'", async () => {
    const dir = await makeTmp();
    try {
      await writePom(dir, `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>lib</artifactId>
      <version>[1.0,2.0)</version>
    </dependency>
  </dependencies>
</project>`);
      const m = await readManifest(dir);
      const lib = m.dependencies.find((d) => d.artifactId === "lib");
      expect(lib?.version).toBe("range");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E5: no database declared ──────────────────────────────────────────────────

describe("E5 — no database declared", () => {
  it("readPlatform returns engine=null when no compose/Dockerfile exists", async () => {
    const dir = await makeTmp();
    try {
      const p = await readPlatform(dir);
      expect(p.database?.engine).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E6: multiple databases ────────────────────────────────────────────────────

describe("E6 — multiple databases", () => {
  it("readPlatform returns allFound with length ≥ 2 when two DB services exist", async () => {
    const dir = await makeTmp();
    try {
      await writeCompose(dir, `services:
  postgres:
    image: postgres:13
  mysql:
    image: mysql:8.0
`);
      const p = await readPlatform(dir);
      expect(p.database?.allFound.length).toBeGreaterThanOrEqual(2);
      const engines = p.database!.allFound.map((e) => e.engine);
      expect(engines).toContain("postgres");
      expect(engines).toContain("mysql");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E7: stale cache fallback ──────────────────────────────────────────────────

describe("E7 — stale cache fallback", () => {
  it("fetchArtifact falls back to stale cache when network is unavailable", async () => {
    const dir = await makeTmp();
    // Write a stale cache entry (fetchedAt 25 hours ago)
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await cacheSet(dir, "org.postgresql:postgresql", {
      groupId: "org.postgresql",
      artifactId: "postgresql",
      latestVersion: "42.7.3",
      versions: ["42.7.3"],
      fetchedAt: staleDate,
      stale: false,
      available: true,
    });
    // Inject failing fetch
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    try {
      const r = await fetchArtifact(dir, "org.postgresql", "postgresql");
      // Should return stale data rather than throwing
      expect(r.found).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E8: rate-limited registry ─────────────────────────────────────────────────

describe("E8 — 429 rate limit", () => {
  it("fetchArtifact retries once and succeeds on 200", async () => {
    const dir = await makeTmp();
    const RESPONSE = JSON.stringify({
      response: { numFound: 1, docs: [{ g: "org.postgresql", a: "postgresql", v: "42.7.3", timestamp: 1700000000000 }] },
    });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.resolve({ ok: false, status: 429 });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(RESPONSE)) });
    }));
    try {
      const r = await fetchArtifact(dir, "org.postgresql", "postgresql");
      expect(r.found).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fetchArtifact returns not-found when both attempts return 429", async () => {
    const dir = await makeTmp();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    try {
      const r = await fetchArtifact(dir, "com.example", "lib");
      expect(r.found).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E9: artifact not in registry ─────────────────────────────────────────────

describe("E9 — artifact not in registry", () => {
  it("fetchArtifact returns found=false when docs is empty", async () => {
    const dir = await makeTmp();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response: { numFound: 0, docs: [] } }),
      }),
    );
    try {
      const r = await fetchArtifact(dir, "com.internal", "private-lib");
      expect(r.found).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E13: dep declared but unused ──────────────────────────────────────────────

describe("E13 — dep declared but unused", () => {
  it("declared dependency with no matching import has an empty importMap list", async () => {
    const dir = await makeTmp();
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "App.java"),
      "package app;\npublic class App { public static void main(String[] args) {} }\n",
      "utf8",
    );
    const dep = {
      groupId: "org.postgresql",
      artifactId: "postgresql",
      version: "42.2.5",
      scope: "compile",
      versionRaw: "42.2.5",
    };
    try {
      const { importMap } = await scanImports(dir, [dep]);
      expect(importMap["org.postgresql"]).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E14: import groupId not in deps ──────────────────────────────────────────

describe("E14 — import groupId not in dependency list", () => {
  it("scanImports skips imports that don't match any declared dependency", async () => {
    const dir = await makeTmp();
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "Foo.java"),
      "import com.unknowngroup.lib.Foo;\n",
      "utf8",
    );
    // No deps passed → nothing matches → importMap should be empty
    try {
      const { importMap } = await scanImports(dir, []);
      expect(Object.keys(importMap).length).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E16: missing state.json ───────────────────────────────────────────────────

describe("E16 — missing state.json", () => {
  it("readState throws CtxError E16 when .ctx/state.json does not exist", async () => {
    const dir = await makeTmp();
    try {
      await expect(readState(dir)).rejects.toMatchObject({ code: "E16" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E17: corrupt cache ────────────────────────────────────────────────────────

describe("E17 — corrupt cache", () => {
  it("corrupt cache JSON is deleted and treated as a miss", async () => {
    const dir = await makeTmp();
    const cacheDir = path.join(dir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "test__entry.json");
    await fs.writeFile(cacheFile, "{not-json", "utf8");
    try {
      const entry = await cacheGet(dir, "test:entry");
      expect(entry).toBeNull();
      await expect(fs.access(cacheFile)).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("cache entry written > 24h ago is returned as stale", async () => {
    const dir = await makeTmp();
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await cacheSet(dir, "test:entry", {
      groupId: "test",
      artifactId: "entry",
      latestVersion: "1.0.0",
      versions: ["1.0.0"],
      fetchedAt: oldDate,
      stale: false,
      available: true,
    });
    try {
      const entry = await cacheGet(dir, "test:entry");
      expect(entry).not.toBeNull();
      expect(entry!.stale).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("cache entry written < 24h ago is returned as fresh", async () => {
    const dir = await makeTmp();
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    await cacheSet(dir, "test:fresh", {
      groupId: "test",
      artifactId: "fresh",
      latestVersion: "2.0.0",
      versions: ["2.0.0"],
      fetchedAt: recentDate,
      stale: false,
      available: true,
    });
    try {
      const entry = await cacheGet(dir, "test:fresh");
      expect(entry).not.toBeNull();
      expect(entry!.stale).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E18: import scan file cap ─────────────────────────────────────────────────

describe("E18 — more than 5000 source files", () => {
  it("scanImports caps at 5000 files and reports capped=true", async () => {
    const dir = await makeTmp();
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 5001; i++) {
      writes.push(fs.writeFile(path.join(srcDir, `F${i}.java`), "class F {}\n", "utf8"));
    }
    await Promise.all(writes);
    try {
      const { capped } = await scanImports(dir, []);
      expect(capped).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

// ── E19: docker-compose.yml vs docker-compose.yaml preference ────────────────

describe("E19 — docker-compose.yml preferred over docker-compose.yaml", () => {
  it("uses docker-compose.yml when both files exist", async () => {
    const dir = await makeTmp();
    try {
      await fs.writeFile(
        path.join(dir, "docker-compose.yml"),
        `services:\n  db:\n    image: postgres:13\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(dir, "docker-compose.yaml"),
        `services:\n  db:\n    image: mysql:8.0\n`,
        "utf8",
      );
      const p = await readPlatform(dir);
      // Should pick postgres from .yml, not mysql from .yaml
      expect(p.database?.engine).toBe("postgres");
      expect(p.database?.version).toBe("13");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── E20: downgrade check not supported ───────────────────────────────────────

describe("E20 — downgrade not supported", () => {
  it("runEngine throws when targetJava < declaredJavaVersion", async () => {
    const state: StateJson = {
      ...MINIMAL_STATE,
      declaredRuntimeVersion: "11",
    };
    const db = loadCompatibility();
    expect(() => runEngine(state, "8", db, {})).toThrow(/E20/);
  });
});
