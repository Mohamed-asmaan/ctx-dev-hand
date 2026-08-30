// tests/unit/engine/c2.test.ts
// C2: dependency upgrade drops database support.
// Pure functions — no I/O, no network.

import { describe, it, expect } from "vitest";
import { runC1, runC2 } from "../../../src/compat/engine.js";
import type { CompatibilityDb, CompatConstraint } from "../../../src/compat/loader.js";
import type { StateJson, Finding } from "../../../src/store/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStateWithDB(
  dbEngine: string | null,
  dbVersion: string | null,
  dependencies = [
    { groupId: "org.postgresql", artifactId: "postgresql", version: "42.2.5", scope: "compile", versionRaw: "42.2.5" },
  ],
): StateJson {
  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    language: "java",
    declaredRuntimeVersion: "8",
    buildTool: "maven",
    manifestPath: "pom.xml",
    parentResolved: true,
    platform: {
      database: dbEngine
        ? {
            engine: dbEngine,
            version: dbVersion!,
            declaredIn: "docker-compose.yml:3",
            confidence: "declared",
            allFound: [{ engine: dbEngine, version: dbVersion!, declaredIn: "docker-compose.yml:3", service: "db" }],
          }
        : { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] },
    },
    importMap: {},
    dependencies,
  };
}

// A CompatibilityDb that says postgres driver 42.2.5 must upgrade to 42.3.0 for Java 11,
// and that 42.3.0 requires postgres >= 10.
function makeRealCompatDb(): CompatibilityDb {
  return {
    getConstraints: (groupId, artifactId) => {
      if (groupId === "org.postgresql" && artifactId === "postgresql") {
        return [
          {
            fromVersion: "42.3.0",
            requires: { postgres: ">=10" },
            note: "Dropped PostgreSQL 9.6 support",
            verifiedAt: "2026-01-01",
            sourceUrl: "https://jdbc.postgresql.org",
          },
        ];
      }
      return [];
    },
    getMinVersionForTarget: (groupId, _artifactId, _lang, targetVer) => {
      if (groupId === "org.postgresql" && targetVer === "11") return "42.3.0";
      return null;
    },
    getRuntimeRemovals: () => [],
    getRaw: () => [],
  };
}

// A C1 finding that forced a driver upgrade
function makeC1Finding(): Finding {
  return {
    id: "F1",
    class: "C1_language_forces_dependency",
    severity: "blocking",
    dependency: "org.postgresql:postgresql",
    installed: "42.2.5",
    minimumForTarget: "42.3.0",
    dependsOn: null,
    evidence: { fact: "test", source: "curated", fetchedAt: new Date().toISOString() },
    reason: "test reason",
  };
}

// ---------------------------------------------------------------------------
// C2 tests
// ---------------------------------------------------------------------------

describe("C2: dependency drops database", () => {
  it("C1 forced upgrade AND new version drops declared DB → blocking finding with dependsOn", () => {
    const state = makeStateWithDB("postgres", "9.6");
    const db = makeRealCompatDb();
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, db);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe("C2_dependency_drops_database");
    expect(findings[0].severity).toBe("blocking");
    expect(findings[0].dependsOn).toBe("F1");
  });

  it("C2 finding dependsOn points at the correct C1 finding id", () => {
    const state = makeStateWithDB("postgres", "9.6");
    const db = makeRealCompatDb();
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, db);
    expect(findings[0].dependsOn).toBe(c1[0].id);
  });

  it("C1 forced upgrade BUT new version still supports declared DB → no finding", () => {
    const state = makeStateWithDB("postgres", "12"); // DB is 12, requirement is >=10
    const db = makeRealCompatDb();
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, db);
    expect(findings).toHaveLength(0);
  });

  it("no database declared → C2 skipped, output states it explicitly", () => {
    const state = makeStateWithDB(null, null);
    const db = makeRealCompatDb();
    const c1 = [makeC1Finding()];
    const { findings, skipped, skipReason } = runC2(state, c1, db);
    expect(findings).toHaveLength(0);
    expect(skipped).toBe(true);
    expect(skipReason).toMatch(/no database/i);
  });

  it("database declared but dependency has no DB constraint → no finding", () => {
    const state = makeStateWithDB("postgres", "9.6");
    const dbNoConstraint: CompatibilityDb = {
      getConstraints: () => [], // no constraints for any dep
      getMinVersionForTarget: () => "42.3.0",
      getRuntimeRemovals: () => [],
      getRaw: () => [],
    };
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, dbNoConstraint);
    expect(findings).toHaveLength(0);
  });

  it("DB version exactly at boundary (>=9.6 vs 9.6) → no finding", () => {
    const state = makeStateWithDB("postgres", "9.6");
    const dbExactBoundary: CompatibilityDb = {
      getConstraints: () => [
        {
          fromVersion: "42.3.0",
          requires: { postgres: ">=9.6" }, // exactly at boundary
          note: "test",
          verifiedAt: "2026-01-01",
          sourceUrl: "https://example.com",
        },
      ],
      getMinVersionForTarget: () => "42.3.0",
      getRuntimeRemovals: () => [],
      getRaw: () => [],
    };
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, dbExactBoundary);
    expect(findings).toHaveLength(0);
  });

  it("DB version one below boundary → finding emitted", () => {
    const state = makeStateWithDB("postgres", "9");
    const db = makeRealCompatDb(); // requires postgres >=10
    const c1 = [makeC1Finding()];
    const { findings } = runC2(state, c1, db);
    expect(findings).toHaveLength(1);
  });

  it("CRITICAL: C2 finding cannot exist without its C1 parent", () => {
    const state = makeStateWithDB("postgres", "9.6");
    const db = makeRealCompatDb();
    // Pass empty C1 findings
    const { findings } = runC2(state, [], db);
    // With no C1 findings, C2 has nothing to chain from
    expect(findings).toHaveLength(0);
  });
});
