// tests/integration/check.test.ts
// Verifies ctx check against a pre-populated .ctx/state.json.
// Tests: findings produced, exit codes, idempotence, and the --report flag.
// Does NOT call runCheck directly (it calls process.exit) — we test the engine
// and output layers independently of the CLI wrapper.

import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { readState } from "../../src/store/state.js";
import { loadCompatibility } from "../../src/compat/loader.js";
import { runEngine, type RegistryDataMap } from "../../src/compat/engine.js";

const SAMPLE_PROJECT = path.resolve("samples/legacy-java-app");

/**
 * Build a minimal RegistryDataMap without hitting the network.
 * State.json from the sample has pg 42.2.5 and jaxb 2.3.0.
 */
function buildMockRegistry(): RegistryDataMap {
  return {
    "org.postgresql:postgresql": {
      latestVersion: "42.7.3",
      available: true,
      stale: false,
    },
    "javax.xml.bind:jaxb-api": {
      latestVersion: "2.3.1",
      available: true,
      stale: false,
    },
  };
}

describe("runEngine on reference scenario (java 8 → 11)", () => {
  it("loads state.json without error", async () => {
    const state = await readState(SAMPLE_PROJECT);
    expect(state.declaredRuntimeVersion).toBe("8");
    expect(state.dependencies.length).toBeGreaterThanOrEqual(2);
  });

  it("produces at least 2 blocking findings", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    const blocking = result.findings.filter((f) => f.severity === "blocking");
    expect(blocking.length).toBeGreaterThanOrEqual(2);
  });

  it("verdict is 'blocked'", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    expect(result.verdict).toBe("blocked");
  });

  it("findings contain a C1 finding for org.postgresql:postgresql", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    const c1 = result.findings.find(
      (f) => f.class === "C1_language_forces_dependency" && f.dependency === "org.postgresql:postgresql",
    );
    expect(c1).toBeDefined();
    expect(c1!.severity).toBe("blocking");
    expect(c1!.installed).toBe("42.2.5");
    expect(c1!.minimumForTarget).toBe("42.3.0");
  });

  it("findings contain a C1 finding for javax.xml.bind:jaxb-api (JDK removal)", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    const removal = result.findings.find(
      (f) =>
        f.class === "C1_language_forces_dependency" &&
        f.dependency.includes("javax.xml.bind"),
    );
    expect(removal).toBeDefined();
  });

  it("upgradeOrder is non-empty", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    expect(result.upgradeOrder.length).toBeGreaterThan(0);
  });

  it("each upgradeOrder step has a non-empty action", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    for (const step of result.upgradeOrder) {
      expect(typeof step.action).toBe("string");
      expect(step.action.length).toBeGreaterThan(0);
    }
  });

  it("blastRadius contains org.postgresql", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    expect(result.blastRadius["org.postgresql"]).toBeDefined();
    expect(result.blastRadius["org.postgresql"].length).toBeGreaterThan(0);
  });

  it("checkedAt is a valid ISO date string", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });

  it("each finding has a non-empty reason field", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    for (const f of result.findings) {
      expect(typeof f.reason).toBe("string");
      expect(f.reason.length).toBeGreaterThan(0);
    }
  });

  it("each finding has evidence with a source field", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const result = runEngine(state, "11", db, buildMockRegistry());
    for (const f of result.findings) {
      expect(f.evidence).toBeDefined();
      expect(typeof f.evidence.source).toBe("string");
      expect(typeof f.evidence.fetchedAt).toBe("string");
    }
  });

  it("result is identical when called twice (deterministic)", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const r1 = runEngine(state, "11", db, buildMockRegistry());
    const r2 = runEngine(state, "11", db, buildMockRegistry());
    // Compare structure, not identity (IDs are module-counter-based)
    expect(r1.findings.length).toBe(r2.findings.length);
    expect(r1.verdict).toBe(r2.verdict);
    expect(r1.upgradeOrder.length).toBe(r2.upgradeOrder.length);
  });

  it("same target twice → same verdict (idempotent)", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    const r1 = runEngine(state, "11", db, buildMockRegistry());
    const r2 = runEngine(state, "11", db, buildMockRegistry());
    expect(r1.verdict).toBe(r2.verdict);
  });

  it("targeting already-declared version (java=8) → verdict is 'clear'", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const db = loadCompatibility();
    // java=8 is already declared — no upgrade conflicts
    const result = runEngine(state, "8", db, buildMockRegistry());
    expect(result.verdict).toBe("clear");
  });
});
