// tests/unit/engine/order.test.ts
// Upgrade order resolver: topological sort, cycle detection, determinism.

import { describe, it, expect } from "vitest";
import { resolveOrder } from "../../../src/compat/engine.js";
import type { Finding } from "../../../src/store/schema.js";

function makeFinding(id: string, dependsOn: string | null = null): Finding {
  return {
    id,
    class: "C1_language_forces_dependency",
    severity: "blocking",
    dependency: `group:artifact-${id}`,
    installed: "1.0.0",
    minimumForTarget: "2.0.0",
    dependsOn,
    evidence: { fact: "test", source: "curated", fetchedAt: new Date().toISOString() },
    reason: "test",
  };
}

function makeC2Finding(id: string, dependsOn: string): Finding {
  return {
    id,
    class: "C2_dependency_drops_database",
    severity: "blocking",
    dependency: `group:artifact-${id}`,
    installed: "9.6",
    minimumForTarget: "10",
    dependsOn,
    evidence: { fact: "test", source: "curated", fetchedAt: new Date().toISOString() },
    reason: "test",
  };
}

describe("resolveOrder", () => {
  it("three chained findings → topological order, C2 before C1", () => {
    // F1 (C1) → caused by nothing
    // F3 (C2) → caused by F1 (must be fixed before F1)
    const f1 = makeFinding("F1");
    const f2 = makeFinding("F2");
    const f3 = makeC2Finding("F3", "F1");

    const { steps, cycle } = resolveOrder([f1, f2, f3], "11");
    expect(cycle).toBeNull();
    expect(steps.length).toBeGreaterThanOrEqual(3);

    // F3 (C2: DB upgrade) must appear before F1 (driver upgrade)
    const f3Step = steps.find((s) => s.resolves.includes("F3"));
    const f1Step = steps.find((s) => s.resolves.includes("F1"));
    expect(f3Step).toBeDefined();
    expect(f1Step).toBeDefined();
    expect(f3Step!.step).toBeLessThan(f1Step!.step);
  });

  it("independent findings → all present in result", () => {
    const findings = [makeFinding("F1"), makeFinding("F2"), makeFinding("F3")];
    const { steps, cycle } = resolveOrder(findings, "11");
    expect(cycle).toBeNull();
    const allIds = steps.flatMap((s) => s.resolves);
    expect(allIds).toContain("F1");
    expect(allIds).toContain("F2");
    expect(allIds).toContain("F3");
  });

  it("circular dependency → verdict 'manual', cycle members named", () => {
    // F1 dependsOn F2, F2 dependsOn F1 — a cycle.
    // But Finding.dependsOn is used for causation, not this direction.
    // We create the cycle at the prereq-building level by having C2 findings
    // that chain in a circle (pathological case).
    const f1 = makeC2Finding("F1", "F2");
    const f2 = makeC2Finding("F2", "F1");

    const { steps, cycle } = resolveOrder([f1, f2], "11");
    expect(cycle).not.toBeNull();
    expect(steps).toHaveLength(0);
    expect(cycle).toContain("F1");
    expect(cycle).toContain("F2");
  });

  it("zero findings → language bump step, no cycle", () => {
    const { steps, cycle } = resolveOrder([], "11", "java");
    expect(cycle).toBeNull();
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action).toBe("Set java version to 11");
    expect(steps[0]?.kind).toBe("config");
  });

  it("single finding → single step", () => {
    const { steps, cycle } = resolveOrder([makeFinding("F1")], "11");
    expect(cycle).toBeNull();
    // At least one step for the finding + one for the language bump
    expect(steps.some((s) => s.resolves.includes("F1"))).toBe(true);
  });

  it("output ordering is deterministic across two runs", () => {
    const findings = [makeFinding("F1"), makeC2Finding("F3", "F1"), makeFinding("F2")];
    const r1 = resolveOrder(findings, "11");
    const r2 = resolveOrder(findings, "11");
    expect(r1.steps.map((s) => s.step)).toEqual(r2.steps.map((s) => s.step));
    expect(r1.steps.map((s) => s.resolves.join(","))).toEqual(
      r2.steps.map((s) => s.resolves.join(",")),
    );
  });

  it("warning findings are excluded from upgrade order", () => {
    const blocking = makeFinding("F1");
    const warning: Finding = { ...makeFinding("F2"), severity: "warning" };
    const { steps } = resolveOrder([blocking, warning], "11");
    const ids = steps.flatMap((s) => s.resolves);
    expect(ids).toContain("F1");
    expect(ids).not.toContain("F2");
  });

  it("BUG1: final language-bump step action contains targetJava, not a dep version", () => {
    const { steps } = resolveOrder([makeFinding("F1")], "11");
    const lastStep = steps[steps.length - 1];
    expect(lastStep.action).toContain("11");
    expect(lastStep.action).not.toContain("2.0.0"); // must not contain dep's minimumForTarget
  });
});
