import { readState } from "../store/state.js";
import { cacheGet } from "../store/cache.js";
import { loadCompatibility } from "./loader.js";
import { runEngine, type RegistryDataMap } from "./engine.js";
import { evaluateDecision } from "./decision.js";
import { isVersionUpgrade, type ParsedTarget } from "./target.js";
import type { FindingsResult } from "../store/schema.js";
import { readCaseOptional } from "../store/case.js";
import { applyLockedGates } from "../case/locks.js";

export async function evaluateChange(
  repoRoot: string,
  target: ParsedTarget,
): Promise<FindingsResult> {
  const state = await readState(repoRoot);

  if (isVersionUpgrade(state.language, target)) {
    const registryData: RegistryDataMap = {};
    const changelogMap: Record<string, string | undefined> = {};
    for (const dep of state.dependencies) {
      if (dep.version === "unresolved" || dep.version === "range") continue;
      const key = `${dep.groupId}:${dep.artifactId}`;
      const cached = await cacheGet(repoRoot, key);
      if (cached) {
        registryData[key] = {
          latestVersion: cached.latestVersion,
          available: cached.available ?? true,
          stale: cached.stale ?? false,
        };
        changelogMap[key] = cached.changelogText;
      } else {
        registryData[key] = { available: false };
      }
    }
    return applyLockedGates(
      runEngine(state, target.value, loadCompatibility(), registryData, changelogMap),
      await readCaseOptional(repoRoot),
    );
  }

  return applyLockedGates(
    evaluateDecision(state, target.key, target.value),
    await readCaseOptional(repoRoot),
  );
}
