import { selectAdapter, NO_SUPPORTED_PROJECT } from "../adapters/index.js";
import { readPlatform } from "../readers/platform.js";
import { writeState, CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import type { StateJson, Dependency } from "../store/schema.js";

function semaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < limit) {
      active++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  return async function acquire(): Promise<() => void> {
    if (active < limit) {
      active++;
      return () => { active--; next(); };
    }
    return new Promise((resolve) => {
      queue.push(() => {
        resolve(() => { active--; next(); });
      });
    });
  };
}

function toImportMap(
  locations: Array<{ packageId: string; location: string }>,
  dependencies: Dependency[],
): Record<string, string[]> {
  const importMap: Record<string, string[]> = {};
  for (const dep of dependencies) {
    importMap[dep.groupId] = importMap[dep.groupId] ?? [];
  }
  for (const loc of locations) {
    if (!importMap[loc.packageId]) importMap[loc.packageId] = [];
    if (!importMap[loc.packageId].includes(loc.location)) {
      importMap[loc.packageId].push(loc.location);
    }
  }
  return importMap;
}

export async function runScan(repoRoot: string): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);

  const adapter = await selectAdapter(absRoot);
  if (!adapter) {
    process.stderr.write(`[ctx error] ${NO_SUPPORTED_PROJECT}\n`);
    process.exit(2);
  }

  let manifest;
  try {
    manifest = await adapter.readManifest(absRoot);
  } catch (err) {
    if (err instanceof CtxError && err.code === "E1") {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const platform = await readPlatform(absRoot);
  const locations = await adapter.scanImports(absRoot, manifest.dependencies);
  const importMap = toImportMap(locations, manifest.dependencies);

  const concurrentFetch = semaphore(5);
  const concreteDeps = manifest.dependencies.filter(
    (d) => d.version !== "unresolved" && d.version !== "range",
  );

  let cacheHits = 0;
  let freshFetches = 0;

  const fetchResults = await Promise.all(
    concreteDeps.map(async (dep: Dependency) => {
      const release = await concurrentFetch();
      try {
        const result = await adapter.fetchArtifact(absRoot, dep);
        if (result.found && !result.stale) {
          freshFetches++;
        } else if (result.found) {
          cacheHits++;
        }
        return { dep, result };
      } finally {
        release();
      }
    }),
  );

  for (const { dep, result } of fetchResults) {
    if (!result.found) {
      process.stderr.write(
        `[ctx warn] ${dep.groupId}:${dep.artifactId} not found in registry (E9)\n`,
      );
    }
  }

  const state: StateJson = {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    language: manifest.language,
    declaredRuntimeVersion: manifest.declaredRuntimeVersion,
    buildTool: manifest.buildTool,
    manifestPath: manifest.manifestPath,
    parentResolved: manifest.parentResolved,
    dependencies: manifest.dependencies,
    platform,
    importMap,
  };

  await writeState(absRoot, state);

  const dbStatus = state.platform.database?.engine
    ? `${state.platform.database.engine} ${state.platform.database.version} (${state.platform.database.declaredIn})`
    : "not declared";

  const totalImports = Object.values(importMap).reduce((sum, arr) => sum + arr.length, 0);

  const unresolved = manifest.dependencies.filter((d) => d.version === "unresolved").length;
  console.log(`
Scan finished
─────────────────────────────────────────────────────
  Language        : ${state.language} (${state.buildTool})
  Version today   : ${state.declaredRuntimeVersion ?? "(not found in the build file)"}
  Libraries found : ${manifest.dependencies.length}${unresolved > 0 ? ` (${unresolved} without a clear version)` : ""}
  Database        : ${dbStatus === "not declared" ? "none listed in the project" : dbStatus}
  Used in code    : ${totalImports} import(s)
─────────────────────────────────────────────────────
Next: ctx check --target ${state.language}=<version>
`);
}
