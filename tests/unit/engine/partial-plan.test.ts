import { describe, it, expect } from "vitest";
import { runEngine, type RegistryDataMap } from "../../../src/compat/engine.js";
import { loadCompatibility } from "../../../src/compat/loader.js";
import type { StateJson } from "../../../src/store/schema.js";

const state: StateJson = {
  schemaVersion: 1,
  scannedAt: "2026-08-30T00:00:00.000Z",
  language: "java",
  declaredRuntimeVersion: "17",
  buildTool: "maven",
  manifestPath: "pom.xml",
  parentResolved: true,
  dependencies: [
    {
      groupId: "com.google.guava",
      artifactId: "guava",
      version: "31.1-jre",
      scope: "compile",
      versionRaw: "31.1-jre",
    },
  ],
  platform: {
    database: {
      engine: null,
      version: null,
      declaredIn: null,
      confidence: "declared",
      allFound: [],
    },
  },
  importMap: { "com.google.guava": ["src/Main.java:1"] },
};

describe("PARTIAL still returns an upgrade order", () => {
  it("no blocking findings still has Set language step", () => {
    const registry: RegistryDataMap = {
      "com.google.guava:guava": { available: true, latestVersion: "31.1-jre", stale: false },
    };
    const result = runEngine(state, "21", loadCompatibility(), registry);
    expect(result.upgradeOrder.length).toBeGreaterThan(0);
    expect(result.upgradeOrder.some((s) => s.action.includes("Set java version to 21"))).toBe(true);
  });

  it("unevaluated deps prepend a review step", () => {
    const unknown: StateJson = {
      ...state,
      dependencies: [
        {
          groupId: "acme",
          artifactId: "unknown",
          version: "1.0.0",
          scope: "compile",
          versionRaw: "1.0.0",
        },
      ],
      importMap: {},
    };
    const result = runEngine(unknown, "21", loadCompatibility(), {
      "acme:unknown": { available: false },
    });
    expect(result.verdict).toBe("partial");
    expect(result.upgradeOrder[0]?.action).toMatch(/Check whether acme:unknown works/);
    expect(result.upgradeOrder.some((s) => s.action.includes("Set java version to 21"))).toBe(true);
  });
});
