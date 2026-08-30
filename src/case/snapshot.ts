import type { CaseFile, StateJson } from "../store/schema.js";
import { hashFile } from "../store/case.js";
import type { CurrentSnapshot } from "./compare.js";
import { absInRepo, collectTrackedPaths, locationToPath, posixRel } from "./paths.js";

export async function snapshotFromDisk(
  repoRoot: string,
  state: StateJson,
  caseFile: CaseFile,
): Promise<CurrentSnapshot> {
  const baselinePaths = new Set(caseFile.baseline.files.map((f) => f.path));
  const currentTracked = collectTrackedPaths(state);
  const extraImportFiles = currentTracked.filter((p) => !baselinePaths.has(p));

  const files: CurrentSnapshot["files"] = [];
  for (const f of caseFile.baseline.files) {
    files.push({
      path: f.path,
      sha256: await hashFile(absInRepo(repoRoot, f.path)),
    });
  }

  const tests: CurrentSnapshot["tests"] = [];
  for (const t of caseFile.baseline.tests) {
    tests.push({
      path: t.path,
      sha256: await hashFile(absInRepo(repoRoot, t.path)),
    });
  }

  return {
    declaredRuntimeVersion: state.declaredRuntimeVersion,
    language: state.language,
    dependencies: state.dependencies.map((d) => ({
      groupId: d.groupId,
      artifactId: d.artifactId,
      version: d.version,
    })),
    files,
    tests,
    extraImportFiles,
  };
}

export function currentImportPaths(state: StateJson): string[] {
  const paths = new Set<string>();
  for (const locs of Object.values(state.importMap ?? {})) {
    for (const loc of locs) paths.add(posixRel(locationToPath(loc)));
  }
  return [...paths];
}
