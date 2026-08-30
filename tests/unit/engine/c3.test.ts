// tests/unit/engine/c3.test.ts
// C3: EOL and advisories.

import { describe, it, expect } from "vitest";
import { runC3 } from "../../../src/compat/engine.js";
import type { StateJson } from "../../../src/store/schema.js";
import type { RegistryDataMap } from "../../../src/compat/engine.js";

function makeState(version: string): StateJson {
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
      { groupId: "org.postgresql", artifactId: "postgresql", version, scope: "compile", versionRaw: version },
    ],
  };
}

describe("C3: EOL and advisories", () => {
  it("newer version exists → urgency 'optional' (warning, not blocking)", () => {
    const state = makeState("42.2.5");
    const reg: RegistryDataMap = {
      "org.postgresql:postgresql": { latestVersion: "42.7.7", available: true, stale: false },
    };
    const findings = runC3(state, reg);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe("C3_eol_advisory");
    expect(findings[0].severity).toBe("warning");
  });

  it("already at latest → no C3 finding", () => {
    const state = makeState("42.7.7");
    const reg: RegistryDataMap = {
      "org.postgresql:postgresql": { latestVersion: "42.7.7", available: true, stale: false },
    };
    const findings = runC3(state, reg);
    expect(findings).toHaveLength(0);
  });

  it("registry data unavailable → no C3 finding (not false-positive)", () => {
    const state = makeState("42.2.5");
    const reg: RegistryDataMap = {
      "org.postgresql:postgresql": { available: false },
    };
    const findings = runC3(state, reg);
    expect(findings).toHaveLength(0);
  });

  it("no registry data at all → no finding", () => {
    const state = makeState("42.2.5");
    const findings = runC3(state, {});
    expect(findings).toHaveLength(0);
  });

  it("'unresolved' version → skipped", () => {
    const state = makeState("unresolved");
    const reg: RegistryDataMap = {
      "org.postgresql:postgresql": { latestVersion: "42.7.7", available: true, stale: false },
    };
    const findings = runC3(state, reg);
    expect(findings).toHaveLength(0);
  });

  it("finding includes evidence.source = 'registry'", () => {
    const state = makeState("42.2.5");
    const reg: RegistryDataMap = {
      "org.postgresql:postgresql": { latestVersion: "42.7.7", available: true, stale: false },
    };
    const findings = runC3(state, reg);
    expect(findings[0].evidence.source).toBe("registry");
  });
});
