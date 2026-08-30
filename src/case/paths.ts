import path from "node:path";
import fg from "fast-glob";
import type { StateJson } from "../store/schema.js";

export const SCAN_IGNORE = [
  ".git/**",
  ".ctx/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  "target/**",
  "vendor/**",
  ".venv/**",
  "venv/**",
  "env/**",
  "__pycache__/**",
  "coverage/**",
];

const TEST_GLOBS = [
  "**/{test,tests,spec,specs}/**",
  "**/*.{test,spec}.*",
  "**/*_test.*",
  "**/*_spec.*",
];

const TEST_CAP = 200;

/** "path/to/file:12" → "path/to/file" */
export function locationToPath(location: string): string {
  return location.replace(/:\d+$/, "");
}

export function posixRel(p: string): string {
  return p.replace(/\\/g, "/");
}

export function collectTrackedPaths(state: StateJson): string[] {
  const paths = new Set<string>();
  if (state.manifestPath) paths.add(posixRel(state.manifestPath));
  for (const locs of Object.values(state.importMap ?? {})) {
    for (const loc of locs) {
      const rel = locationToPath(loc);
      if (rel) paths.add(posixRel(rel));
    }
  }
  const declaredIn = state.platform?.database?.declaredIn;
  if (declaredIn) paths.add(posixRel(locationToPath(declaredIn)));
  return [...paths].sort();
}

export async function findTestFiles(repoRoot: string): Promise<string[]> {
  let files = await fg(TEST_GLOBS, {
    cwd: repoRoot,
    ignore: SCAN_IGNORE,
    onlyFiles: true,
    unique: true,
  });
  files = files.map(posixRel);
  if (files.length > TEST_CAP) files = files.slice(0, TEST_CAP);
  files.sort();
  return files;
}

export function absInRepo(repoRoot: string, rel: string): string {
  return path.join(repoRoot, rel);
}
