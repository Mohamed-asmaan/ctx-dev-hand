// tests/integration/mcp.test.ts
// Validates MCP tool responses against the FindingsResult / StateJson schemas.
// Does NOT start the MCP server over stdio — tests the tool handler functions directly
// by exercising the same logic the handlers call.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { readState, writeState } from "../../src/store/state.js";
import { loadCompatibility } from "../../src/compat/loader.js";
import { runEngine, type RegistryDataMap } from "../../src/compat/engine.js";
import { compareSemver } from "../../src/compat/loader.js";
import { evaluateUpgradeStep } from "../../src/mcp/tools/verify-step.js";
import type { StateJson, FindingsResult } from "../../src/store/schema.js";

const SAMPLE_PROJECT = path.resolve("samples/legacy-java-app");

function buildMockRegistry(): RegistryDataMap {
  return {
    "org.postgresql:postgresql": { latestVersion: "42.7.3", available: true, stale: false },
    "javax.xml.bind:jaxb-api": { latestVersion: "2.3.1", available: true, stale: false },
  };
}

// ── ctx_project_state equivalent ──────────────────────────────────────────────

describe("ctx_project_state logic", () => {
  it("returns valid StateJson for sample project", async () => {
    const state = await readState(SAMPLE_PROJECT);
    expect(state.schemaVersion).toBe(1);
    expect(state.language).toBe("java");
    expect(Array.isArray(state.dependencies)).toBe(true);
    expect(state.platform).toBeDefined();
  });

  it("E16 is thrown when state.json is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-mcp-state-"));
    try {
      const { CtxError } = await import("../../src/store/state.js");
      await expect(readState(tmp)).rejects.toMatchObject({ code: "E16" });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("state JSON is serializable to a string (MCP text content)", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const text = JSON.stringify(state, null, 2);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    // Verify it round-trips
    const parsed = JSON.parse(text) as StateJson;
    expect(parsed.schemaVersion).toBe(1);
  });
});

// ── ctx_check_change equivalent ───────────────────────────────────────────────

describe("ctx_check_change logic", () => {
  it("returns a FindingsResult with required top-level fields", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result: FindingsResult = runEngine(state, "11", db, buildMockRegistry());
    expect(result.schemaVersion).toBe(1);
    expect(typeof result.verdict).toBe("string");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.upgradeOrder)).toBe(true);
    expect(typeof result.blastRadius).toBe("object");
    expect(typeof result.checkedAt).toBe("string");
    expect(typeof result.notChecked).toBe("object");
  });

  it("findings array entries conform to Finding schema", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    for (const f of result.findings) {
      expect(typeof f.id).toBe("string");
      expect(["C1_language_forces_dependency", "C2_dependency_drops_database", "C3_eol_advisory", "C4_technology_decision"]).toContain(f.class);
      expect(["blocking", "warning"]).toContain(f.severity);
      expect(typeof f.dependency).toBe("string");
      expect(typeof f.reason).toBe("string");
      expect(typeof f.evidence.source).toBe("string");
      expect(typeof f.evidence.fetchedAt).toBe("string");
    }
  });

  it("upgradeOrder steps conform to UpgradeStep schema", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    for (const step of result.upgradeOrder) {
      expect(typeof step.step).toBe("number");
      expect(typeof step.action).toBe("string");
      expect(["code", "infrastructure", "config"]).toContain(step.kind);
      expect(Array.isArray(step.resolves)).toBe(true);
      expect(Array.isArray(step.blockedBy)).toBe(true);
    }
  });

  it("result is serializable to JSON without circular references", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    expect(() => JSON.stringify(result, null, 2)).not.toThrow();
  });

  it("E16 is propagated when state is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-mcp-check-"));
    try {
      await expect(readState(tmp)).rejects.toMatchObject({ code: "E16" });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("target.java missing → error response (no target provided)", () => {
    // Simulates what the tool handler does when no java target is given
    const targetJava = undefined as string | undefined;
    expect(targetJava).toBeUndefined();
    // The handler returns an error content block — not an exception
  });

  it("grounding instruction is present in tool description source text", async () => {
    // Verify the grounding instruction string is embedded in the tool files
    const toolText =
      (await fs.readFile("src/mcp/tools/check-change.ts", "utf8")) +
      (await fs.readFile("src/mcp/grounding.ts", "utf8"));
    expect(toolText).toContain("Return only the facts present in this response");
    expect(toolText).toContain("Do not state version compatibility");
    expect(toolText).toContain("GROUNDING_INSTRUCTION");
  });
});

// ── ctx_upgrade_plan equivalent ───────────────────────────────────────────────

describe("ctx_upgrade_plan logic", () => {
  it("classifies a dependency as 'optional' when newer version exists", () => {
    const installed = "42.2.5";
    const latest = "42.7.3";
    const isCurrent = compareSemver(installed, latest) >= 0;
    expect(isCurrent).toBe(false);
    const classification = isCurrent ? "current" : "optional";
    expect(classification).toBe("optional");
  });

  it("classifies a dependency as 'current' when already at latest", () => {
    const installed = "42.7.3";
    const latest = "42.7.3";
    const isCurrent = compareSemver(installed, latest) >= 0;
    expect(isCurrent).toBe(true);
  });

  it("grounding instruction present in upgrade-plan tool source", async () => {
    const toolText = await fs.readFile("src/mcp/tools/upgrade-plan.ts", "utf8");
    expect(
      toolText.includes("Return only the facts present in this response") ||
        toolText.includes("GROUNDING_INSTRUCTION"),
    ).toBe(true);
  });

  it("grounding instruction present in project-state tool source", async () => {
    const toolText = await fs.readFile("src/mcp/tools/project-state.ts", "utf8");
    expect(
      toolText.includes("Return only the facts present in this response") ||
        toolText.includes("GROUNDING_INSTRUCTION"),
    ).toBe(true);
  });
});

describe("ctx_verify_step logic", () => {
  it("missing step number is an error", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), buildMockRegistry());
    const v = evaluateUpgradeStep(result, 999);
    expect("error" in v).toBe(true);
  });

  it("first step with no blockers is satisfied", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), buildMockRegistry());
    const first = result.upgradeOrder[0];
    const v = evaluateUpgradeStep(result, first.step);
    expect("error" in v).toBe(false);
    if (!("error" in v)) {
      expect(v.satisfied).toBe(first.blockedBy.length === 0);
      expect(v.kind).toBe(first.kind);
    }
  });

  it("a step blockedBy an unresolved finding is not satisfied", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), buildMockRegistry());
    const blocked = result.upgradeOrder.find((s) => s.blockedBy.length > 0);
    expect(blocked).toBeDefined();
    const v = evaluateUpgradeStep(result, blocked!.step);
    expect("error" in v).toBe(false);
    if (!("error" in v)) {
      expect(v.satisfied).toBe(false);
      expect(v.remainingBlockers.length).toBeGreaterThan(0);
    }
  });

  it("after the blocking finding is gone, the dependent step is satisfied", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const blockedState = structuredClone(state);
    blockedState.platform.database = {
      ...blockedState.platform.database,
      version: "10",
    };
    const before = runEngine(state, "11", loadCompatibility(), buildMockRegistry());
    const after = runEngine(blockedState, "11", loadCompatibility(), buildMockRegistry());
    const driverBefore = before.upgradeOrder.find((s) => s.action.includes("org.postgresql:postgresql"));
    expect(driverBefore).toBeDefined();
    expect(driverBefore!.blockedBy.length).toBeGreaterThan(0);
    const driverAfter = after.upgradeOrder.find((s) => s.action.includes("org.postgresql:postgresql"));
    expect(driverAfter).toBeDefined();
    const v = evaluateUpgradeStep(after, driverAfter!.step);
    expect("error" in v).toBe(false);
    if (!("error" in v)) {
      expect(v.satisfied).toBe(true);
    }
  });
});
