import { describe, it, expect } from "vitest";
import { compareCase } from "../../../src/case/compare.js";
import { formatBrief, formatCaseGate, formatVerifyReport } from "../../../src/case/report.js";
import type { CaseFile } from "../../../src/store/schema.js";

function sampleCase(overrides: Partial<CaseFile> = {}): CaseFile {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-30T00:00:00.000Z",
    capturedBy: "ctx capture (human)",
    language: "python",
    declaredRuntimeVersion: "2.7",
    buildTool: "pip",
    decisions: [
      {
        id: "human:decision:tax",
        fact: "US tax is 10 percent",
        confirmedBy: "human",
        at: "2026-08-30T00:00:00.000Z",
      },
    ],
    invariants: [{ id: "human:edge:empty-cart", description: "Empty cart returns zero", kind: "edge" }],
    baseline: {
      declaredRuntimeVersion: "2.7",
      language: "python",
      buildTool: "pip",
      manifestPath: "requirements.txt",
      dependencies: [{ groupId: "django", artifactId: "django", version: "1.11.29" }],
      files: [{ path: "app/settings.py", sha256: "abc" }],
      tests: [{ path: "tests/test_settings.py", sha256: "def" }],
    },
    lastVerify: null,
    ...overrides,
  };
}

describe("compareCase", () => {
  it("reports same when runtime, deps, files, and tests match", () => {
    const caseFile = sampleCase();
    const report = compareCase(
      caseFile,
      {
        declaredRuntimeVersion: "2.7",
        language: "python",
        dependencies: [{ groupId: "django", artifactId: "django", version: "1.11.29" }],
        files: [{ path: "app/settings.py", sha256: "abc" }],
        tests: [{ path: "tests/test_settings.py", sha256: "def" }],
        extraImportFiles: [],
      },
      "2026-08-30T01:00:00.000Z",
    );
    expect(report.verdict).toBe("same");
    expect(report.summary).toMatch(/still match/);
  });

  it("reports changed when a tracked file hash drifts", () => {
    const report = compareCase(
      sampleCase(),
      {
        declaredRuntimeVersion: "2.7",
        language: "python",
        dependencies: [{ groupId: "django", artifactId: "django", version: "1.11.29" }],
        files: [{ path: "app/settings.py", sha256: "zzz" }],
        tests: [{ path: "tests/test_settings.py", sha256: "def" }],
        extraImportFiles: [],
      },
      "2026-08-30T01:00:00.000Z",
    );
    expect(report.verdict).toBe("changed");
    expect(report.diffs.some((d) => d.kind === "file" && d.status === "changed")).toBe(true);
  });

  it("reports untested when a new library appears", () => {
    const report = compareCase(
      sampleCase(),
      {
        declaredRuntimeVersion: "2.7",
        language: "python",
        dependencies: [
          { groupId: "django", artifactId: "django", version: "1.11.29" },
          { groupId: "requests", artifactId: "requests", version: "2.0.0" },
        ],
        files: [{ path: "app/settings.py", sha256: "abc" }],
        tests: [{ path: "tests/test_settings.py", sha256: "def" }],
        extraImportFiles: [],
      },
      "2026-08-30T01:00:00.000Z",
    );
    expect(report.verdict).toBe("untested");
  });
});

describe("plain case reports", () => {
  it("brief is short and names the language", () => {
    const text = formatBrief(sampleCase());
    expect(text).toMatch(/python 2\.7/);
    expect(text.split("\n").length).toBeLessThan(16);
    expect(text).toMatch(/Do not re-explain the whole repo/);
  });

  it("verify report stays in plain language", () => {
    const caseFile = sampleCase();
    const report = compareCase(
      caseFile,
      {
        declaredRuntimeVersion: "3.11",
        language: "python",
        dependencies: [{ groupId: "django", artifactId: "django", version: "1.11.29" }],
        files: [{ path: "app/settings.py", sha256: "abc" }],
        tests: [{ path: "tests/test_settings.py", sha256: "def" }],
        extraImportFiles: [],
      },
      "2026-08-30T01:00:00.000Z",
    );
    const text = formatVerifyReport(report, caseFile);
    expect(text).toMatch(/CHANGED/);
    expect(text).toMatch(/Show this report/);
  });

  it("gate lists recorded edges and asks to capture when missing", () => {
    expect(formatCaseGate(null)).toMatch(/Run ctx capture/);
    expect(formatCaseGate(sampleCase())).toMatch(/Empty cart returns zero/);
    expect(formatCaseGate(sampleCase())).toMatch(/US tax is 10 percent/);
  });
});
