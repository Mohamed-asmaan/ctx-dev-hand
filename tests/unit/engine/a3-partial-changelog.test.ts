import { describe, it, expect } from "vitest";
import { runC1, runEngine } from "../../../src/compat/engine.js";
import { loadCompatibility } from "../../../src/compat/loader.js";
import { parseChangelog } from "../../../src/compat/changelog.js";
import type { StateJson } from "../../../src/store/schema.js";

function baseState(deps: StateJson["dependencies"]): StateJson {
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
    dependencies: deps,
  };
}

const PG = {
  groupId: "org.postgresql",
  artifactId: "postgresql",
  version: "42.2.5",
  scope: "compile",
  versionRaw: "42.2.5",
};

describe("A3 — target at or above known minimum", () => {
  it("java 17 still forces postgresql 42.3.0 from the java:11 map entry", () => {
    const findings = runC1(baseState([PG]), "17", loadCompatibility());
    const c1 = findings.find((f) => f.dependency === "org.postgresql:postgresql");
    expect(c1).toBeDefined();
    expect(c1!.minimumForTarget).toBe("42.3.0");
  });
});

describe("A4 — coverage-aware verdict", () => {
  it("unknown concrete dep with no changelog → verdict partial", () => {
    const state = baseState([
      { groupId: "com.unknown", artifactId: "lib", version: "1.0.0", scope: "compile", versionRaw: "1.0.0" },
    ]);
    const result = runEngine(state, "11", loadCompatibility(), {});
    expect(result.verdict).toBe("partial");
    expect(result.notChecked.noCompatibility).toContain("com.unknown:lib");
  });
});

describe("changelog tiers E10 / E11", () => {
  it("E10: empty changelog is not parseable", () => {
    expect(parseChangelog("", "java").parseable).toBe(false);
    expect(parseChangelog(null, "java").note).toContain("E10");
  });

  it("E11: text with no version pattern is unparseable — no C1 guessed", () => {
    const inferred = parseChangelog("See the website for details.", "java", "11");
    expect(inferred.parseable).toBe(false);
    expect(inferred.note).toContain("E11");
    const state = baseState([
      { groupId: "com.acme", artifactId: "lib", version: "1.0.0", scope: "compile", versionRaw: "1.0.0" },
    ]);
    const result = runEngine(state, "11", loadCompatibility(), {}, { "com.acme:lib": "See the website for details." });
    expect(result.findings.filter((f) => f.class === "C1_language_forces_dependency")).toHaveLength(0);
    expect(result.notChecked.noCompatibility).toContain("com.acme:lib");
  });

  it("E11: language-only phrase is not used as an artifact version", () => {
    const inferred = parseChangelog("This release requires Java 11 or later", "java", "11");
    expect(inferred.parseable).toBe(false);
    expect(inferred.note).toContain("E11");
    const state = baseState([
      { groupId: "com.acme", artifactId: "lib", version: "1.0.0", scope: "compile", versionRaw: "1.0.0" },
    ]);
    const result = runEngine(state, "11", loadCompatibility(), {}, {
      "com.acme:lib": "This release requires Java 11 or later",
    });
    expect(result.findings.filter((f) => f.dependency === "com.acme:lib")).toHaveLength(0);
    expect(result.notChecked.noCompatibility).toContain("com.acme:lib");
  });

  it("parseable changelog can emit changelog-inferred C1", () => {
    const state = baseState([
      { groupId: "com.acme", artifactId: "lib", version: "1.0.0", scope: "compile", versionRaw: "1.0.0" },
    ]);
    const result = runEngine(state, "11", loadCompatibility(), {}, {
      "com.acme:lib": "Java 11 support requires version 2.3.0",
    });
    const c1 = result.findings.find((f) => f.dependency === "com.acme:lib");
    expect(c1).toBeDefined();
    expect(c1!.evidence.source).toBe("changelog-inferred");
    expect(c1!.minimumForTarget).toBe("2.3.0");
  });
});

describe("C-w3 step kind", () => {
  it("C2 database step is infrastructure; language bump is config", () => {
    const state = baseState([PG]);
    state.platform.database = {
      engine: "postgres",
      version: "9.6",
      declaredIn: "docker-compose.yml:3",
      confidence: "declared",
      allFound: [],
    };
    const result = runEngine(state, "11", loadCompatibility(), {
      "org.postgresql:postgresql": { latestVersion: "42.7.3", available: true },
    });
    const dbStep = result.upgradeOrder.find((s) => s.kind === "infrastructure");
    const configStep = result.upgradeOrder.find((s) => s.kind === "config");
    expect(dbStep).toBeDefined();
    expect(configStep).toBeDefined();
  });
});
