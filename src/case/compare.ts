import type {
  CaseFile,
  CaseDependencySnapshot,
  VerifyDiff,
  VerifyReport,
  VerifyVerdict,
} from "../store/schema.js";

export interface CurrentSnapshot {
  declaredRuntimeVersion: string | null;
  language: string;
  dependencies: CaseDependencySnapshot[];
  /** sha256 is null when the file is gone. */
  files: Array<{ path: string; sha256: string | null }>;
  tests: Array<{ path: string; sha256: string | null }>;
  /** Source files now in the import map that were not in the baseline. */
  extraImportFiles: string[];
}

function depKey(d: CaseDependencySnapshot): string {
  return `${d.groupId}:${d.artifactId}`;
}

function fileMap(files: Array<{ path: string; sha256: string | null }>): Map<string, string | null> {
  return new Map(files.map((f) => [f.path, f.sha256]));
}

export function compareCase(caseFile: CaseFile, current: CurrentSnapshot, at: string): VerifyReport {
  const diffs: VerifyDiff[] = [];
  const baseline = caseFile.baseline;

  if (baseline.declaredRuntimeVersion !== current.declaredRuntimeVersion) {
    diffs.push({
      kind: "runtime",
      id: "runtime",
      status: "changed",
      before: baseline.declaredRuntimeVersion ?? "(none)",
      after: current.declaredRuntimeVersion ?? "(none)",
      note: `${baseline.language} runtime moved`,
    });
  } else {
    diffs.push({
      kind: "runtime",
      id: "runtime",
      status: "same",
      before: baseline.declaredRuntimeVersion ?? "(none)",
      after: current.declaredRuntimeVersion ?? "(none)",
    });
  }

  const beforeDeps = new Map(baseline.dependencies.map((d) => [depKey(d), d.version]));
  const afterDeps = new Map(current.dependencies.map((d) => [depKey(d), d.version]));

  for (const [key, version] of beforeDeps) {
    if (!afterDeps.has(key)) {
      diffs.push({
        kind: "dependency",
        id: key,
        status: "missing",
        before: version,
        note: "Library was in the case file and is gone",
      });
    } else if (afterDeps.get(key) !== version) {
      diffs.push({
        kind: "dependency",
        id: key,
        status: "changed",
        before: version,
        after: afterDeps.get(key),
        note: "Library version drifted",
      });
    } else {
      diffs.push({
        kind: "dependency",
        id: key,
        status: "same",
        before: version,
        after: version,
      });
    }
  }

  for (const [key, version] of afterDeps) {
    if (!beforeDeps.has(key)) {
      diffs.push({
        kind: "dependency",
        id: key,
        status: "untested",
        after: version,
        note: "Library was not in the case file",
      });
    }
  }

  const nowFiles = fileMap(current.files);
  for (const f of baseline.files) {
    const hash = nowFiles.get(f.path);
    if (hash === undefined || hash === null) {
      diffs.push({
        kind: "file",
        id: f.path,
        status: "missing",
        before: f.sha256.slice(0, 12),
        note: "Tracked file is gone",
      });
    } else if (hash !== f.sha256) {
      diffs.push({
        kind: "file",
        id: f.path,
        status: "changed",
        before: f.sha256.slice(0, 12),
        after: hash.slice(0, 12),
        note: "File contents drifted from the case file",
      });
    } else {
      diffs.push({
        kind: "file",
        id: f.path,
        status: "same",
      });
    }
  }

  for (const extra of current.extraImportFiles) {
    diffs.push({
      kind: "file",
      id: extra,
      status: "untested",
      note: "Source file was not in the case file",
    });
  }

  const nowTests = fileMap(current.tests);
  if (baseline.tests.length === 0) {
    diffs.push({
      kind: "test",
      id: "tests",
      status: "untested",
      note: "No tests were recorded in the case file",
    });
  } else {
    for (const t of baseline.tests) {
      const hash = nowTests.get(t.path);
      if (hash === undefined || hash === null) {
        diffs.push({
          kind: "test",
          id: t.path,
          status: "missing",
          note: "Recorded test file is gone",
        });
      } else if (hash !== t.sha256) {
        diffs.push({
          kind: "test",
          id: t.path,
          status: "changed",
          before: t.sha256.slice(0, 12),
          after: hash.slice(0, 12),
          note: "Test file drifted",
        });
      } else {
        diffs.push({
          kind: "test",
          id: t.path,
          status: "same",
        });
      }
    }
  }

  for (const inv of caseFile.invariants) {
    diffs.push({
      kind: "invariant",
      id: inv.id,
      status: "untested",
      note: `Person must still confirm (${inv.kind}): ${inv.description}`,
    });
  }

  const notable = diffs.filter((d) => d.status !== "same");
  const hasChanged = notable.some((d) => d.status === "changed" || d.status === "missing");

  // Prose invariants are never auto-proven; they do not flip a clean baseline to untested.
  const materialUntested = notable.some(
    (d) => d.status === "untested" && d.kind !== "invariant",
  );

  let verdict: VerifyVerdict;
  if (hasChanged) verdict = "changed";
  else if (materialUntested) verdict = "untested";
  else verdict = "same";

  const changedCount = notable.filter((d) => d.status === "changed" || d.status === "missing").length;
  const untestedCount = notable.filter((d) => d.status === "untested" && d.kind !== "invariant").length;

  let summary: string;
  if (verdict === "changed") {
    summary = `${changedCount} recorded item(s) drifted from the case file.`;
  } else if (verdict === "untested") {
    summary = `Nothing recorded drifted, but ${untestedCount} item(s) were never in the case file.`;
  } else {
    summary = "Tracked files, libraries, and runtime still match the case file.";
    if (caseFile.invariants.length) {
      summary += ` ${caseFile.invariants.length} recorded edge(s) still need a person to confirm.`;
    }
  }

  return { at, verdict, summary, diffs };
}
