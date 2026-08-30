import { describe, it, expect } from "vitest";
import { applyLockedGates } from "../../../src/case/locks.js";
import { formatCaseGate } from "../../../src/case/report.js";
import { formatPlainReport } from "../../../src/output/plain.js";
import type { CaseFile, FindingsResult, StateJson } from "../../../src/store/schema.js";

function caseFile(lockedFact: string): CaseFile {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-30T00:00:00.000Z",
    capturedBy: "ctx capture (human)",
    language: "python",
    declaredRuntimeVersion: null,
    buildTool: "pip",
    decisions: [
      {
        id: "human:lock:bind",
        fact: lockedFact,
        confirmedBy: "owner",
        at: "2026-08-30T00:00:00.000Z",
        locked: true,
      },
    ],
    invariants: [{ id: "human:edge:empty", description: "Empty cart returns zero", kind: "edge" }],
    baseline: {
      declaredRuntimeVersion: null,
      language: "python",
      buildTool: "pip",
      manifestPath: "requirements.txt",
      dependencies: [],
      files: [],
      tests: [],
    },
    lastVerify: null,
  };
}

const clearResult: FindingsResult = {
  schemaVersion: 1,
  verdict: "clear",
  summary: "no known problems",
  findings: [],
  upgradeOrder: [],
  blastRadius: {},
  checkedAt: "2026-08-30T00:00:00.000Z",
  notChecked: { unresolved: [], range: [], noRegistry: [], noCompatibility: [] },
};

const state: StateJson = {
  schemaVersion: 1,
  scannedAt: "2026-08-30T00:00:00.000Z",
  language: "python",
  declaredRuntimeVersion: null,
  buildTool: "pip",
  manifestPath: "requirements.txt",
  parentResolved: false,
  dependencies: [],
  platform: {
    database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] },
  },
  importMap: {},
};

describe("locked decisions", () => {
  it("blocks a modernization check and names the lock", () => {
    const gated = applyLockedGates(clearResult, caseFile("Listen on 0.0.0.0. Do not change that."));
    expect(gated.verdict).toBe("blocked");
    expect(gated.summary).toMatch(/locked decision/);
    expect(gated.findings[0]?.reason).toMatch(/system failure/);
    expect(gated.findings[0]?.reason).toMatch(/0\.0\.0\.0/);
  });

  it("leaves a check alone when nothing is locked", () => {
    const open = caseFile("unused");
    open.decisions[0].locked = false;
    expect(applyLockedGates(clearResult, open).verdict).toBe("clear");
  });

  it("check report lists locks and every recorded edge", () => {
    const file = caseFile("Passwords stay md5 until a person unlocks that.");
    const gated = applyLockedGates(clearResult, file);
    const text = formatPlainReport(gated, state, "python=3.12", file);
    expect(text).toMatch(/LOCKED — modernizing would cause system failure/);
    expect(text).toMatch(/Passwords stay md5/);
    expect(text).toMatch(/Empty cart returns zero/);
    expect(text).toMatch(/STOPPED/);
  });

  it("gate lists locked facts before edges", () => {
    const text = formatCaseGate(caseFile("Thin clients hit this box by IP."));
    expect(text).toMatch(/LOCKED — modernizing would cause system failure/);
    expect(text).toMatch(/\(locked\) Thin clients hit this box by IP/);
    expect(text).toMatch(/Empty cart returns zero/);
  });
});
