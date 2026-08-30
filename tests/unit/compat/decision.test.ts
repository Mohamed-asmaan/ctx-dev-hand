import { describe, it, expect } from "vitest";
import { evaluateDecision } from "../../../src/compat/decision.js";
import { isVersionUpgrade, parseTarget } from "../../../src/compat/target.js";
import type { StateJson } from "../../../src/store/schema.js";

const state: StateJson = {
  schemaVersion: 1,
  scannedAt: "2026-08-30T00:00:00.000Z",
  language: "go",
  declaredRuntimeVersion: "1.16",
  buildTool: "go",
  manifestPath: "go.mod",
  parentResolved: true,
  dependencies: [
    {
      groupId: "github.com/lib/pq",
      artifactId: "pq",
      version: "1.9.0",
      scope: "runtime",
      versionRaw: "v1.9.0",
    },
  ],
  platform: {
    database: { engine: "postgres", version: "9.6", declaredIn: "docker-compose.yml", confidence: "declared", allFound: [] },
  },
  importMap: {},
};

describe("technology decisions", () => {
  it("parseTarget accepts decision specs", () => {
    expect(parseTarget("architecture=microservices")).toEqual({
      key: "architecture",
      value: "microservices",
    });
    expect(parseTarget("go=1.22")).toEqual({ key: "go", value: "1.22" });
  });

  it("version upgrade only when language matches and value is a version", () => {
    expect(isVersionUpgrade("go", { key: "go", value: "1.22" })).toBe(true);
    expect(isVersionUpgrade("go", { key: "architecture", value: "microservices" })).toBe(false);
    expect(isVersionUpgrade("go", { key: "rewrite", value: "rust" })).toBe(false);
  });

  it("evaluateDecision is manual and never auto-applies infrastructure", () => {
    const result = evaluateDecision(state, "architecture", "microservices");
    expect(result.verdict).toBe("manual");
    expect(result.findings[0]?.class).toBe("C4_technology_decision");
    expect(result.findings[0]?.compatibilityKnown).toBe(false);
    expect(result.upgradeOrder.some((s) => s.kind === "infrastructure")).toBe(true);
    expect(result.upgradeOrder.find((s) => s.kind === "infrastructure")?.action).toMatch(/Never auto-apply/i);
  });
});
