// tests/unit/engine/c1.test.ts
// C1: language forces dependency upgrade.
// These tests use hand-built state objects — no files, no network.

import { describe, it, expect } from "vitest";
import { runC1 } from "../../../src/compat/engine.js";
import type { CompatibilityDb, CompatConstraint } from "../../../src/compat/loader.js";
import type { StateJson } from "../../../src/store/schema.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCompatDb(opts: {
  minVersion?: string;
  removedPackages?: string[];
} = {}): CompatibilityDb {
  return {
    getConstraints: () => [],
    getMinVersionForTarget: (_g, _a, _lang, _ver) => opts.minVersion ?? null,
    getRuntimeRemovals: () => opts.removedPackages ?? [],
    getRaw: () => [],
  };
}

function makeState(overrides: Partial<StateJson> = {}): StateJson {
  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    language: "java",
    declaredRuntimeVersion: "8",
    buildTool: "maven",
    manifestPath: "pom.xml",
    parentResolved: true,
    platform: { database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] } },
    importMap: {},
    dependencies: [
      {
        groupId: "org.postgresql",
        artifactId: "postgresql",
        version: "42.2.5",
        scope: "compile",
        versionRaw: "42.2.5",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// C1 tests
// ---------------------------------------------------------------------------

describe("C1: language forces dependency", () => {
  it("installed below minimum → blocking finding emitted", () => {
    const state = makeState();
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe("C1_language_forces_dependency");
    expect(findings[0].severity).toBe("blocking");
    expect(findings[0].installed).toBe("42.2.5");
    expect(findings[0].minimumForTarget).toBe("42.3.0");
  });

  it("installed at exactly minimum → no finding (boundary condition)", () => {
    const state = makeState({
      dependencies: [
        { groupId: "org.postgresql", artifactId: "postgresql", version: "42.3.0", scope: "compile", versionRaw: "42.3.0" },
      ],
    });
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(0);
  });

  it("installed above minimum → no finding", () => {
    const state = makeState({
      dependencies: [
        { groupId: "org.postgresql", artifactId: "postgresql", version: "42.7.7", scope: "compile", versionRaw: "42.7.7" },
      ],
    });
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(0);
  });

  it("dependency absent from curated data → no finding, dep is not in result", () => {
    const state = makeState();
    const db = makeCompatDb({ minVersion: undefined }); // no data for any dep
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(0);
  });

  it("version marked 'unresolved' → skipped, no finding", () => {
    const state = makeState({
      dependencies: [
        { groupId: "org.postgresql", artifactId: "postgresql", version: "unresolved", scope: "compile", versionRaw: "${pg.version}" },
      ],
    });
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(0);
  });

  it("version marked 'range' → skipped, no finding", () => {
    const state = makeState({
      dependencies: [
        { groupId: "org.postgresql", artifactId: "postgresql", version: "range", scope: "compile", versionRaw: "[42.0,43.0)" },
      ],
    });
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(0);
  });

  it("JDK removal: dep groupId matches removed package → blocking finding, minimumForTarget=null", () => {
    const state = makeState({
      dependencies: [
        { groupId: "javax.xml.bind", artifactId: "jaxb-api", version: "2.3.0", scope: "compile", versionRaw: "2.3.0" },
      ],
    });
    const db: CompatibilityDb = {
      getConstraints: () => [],
      getMinVersionForTarget: () => null,
      getRuntimeRemovals: () => ["javax.xml.bind"],
      getRaw: () => [
        {
          key: "jdk:removals",
          constraints: [
            {
              fromVersion: "11",
              removed: ["javax.xml.bind"],
              note: "Removed in Java 11",
              verifiedAt: "2026-01-01",
              sourceUrl: "https://openjdk.org",
            },
          ],
        },
      ],
    };
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe("C1_language_forces_dependency");
    expect(findings[0].minimumForTarget).toBeNull();
    expect(findings[0].severity).toBe("blocking");
  });

  it("E20: target < declared → throws with E20 prefix", () => {
    const state = makeState({ declaredRuntimeVersion: "11" });
    const db = makeCompatDb();
    expect(() => runC1(state, "8", db)).toThrow(/E20/);
  });

  it("finding id is non-empty string", () => {
    const state = makeState();
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings[0].id).toMatch(/^F\d+$/);
  });

  it("finding has evidence.source = 'curated'", () => {
    const state = makeState();
    const db = makeCompatDb({ minVersion: "42.3.0" });
    const findings = runC1(state, "11", db);
    expect(findings[0].evidence.source).toBe("curated");
  });

  it("BUG2: C1 evidence fact uses java constraint note, not db constraint note", () => {
    const state = makeState();
    const db: CompatibilityDb = {
      getConstraints: () => [
        {
          fromVersion: "42.3.0",
          requires: { postgres: ">=10" },
          note: "DB-only note — must NOT appear in C1",
          verifiedAt: "2026-01-01",
          sourceUrl: "https://example.com",
        },
        {
          fromVersion: "42.0.0",
          requires: { java: ">=8" },
          note: "Java constraint note — should appear in C1",
          verifiedAt: "2026-01-01",
          sourceUrl: "https://example.com",
        },
      ],
      getMinVersionForTarget: () => "42.3.0",
      getRuntimeRemovals: () => [],
      getRaw: () => [],
    };
    const findings = runC1(state, "11", db);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.fact).not.toContain("DB-only note");
    expect(findings[0].evidence.fact).toContain("Java constraint note");
  });
});
