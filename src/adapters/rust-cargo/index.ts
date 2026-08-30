import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, ManifestData, RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";
import { cachedFetch } from "../shared/registry.js";
import { scanDepNames } from "../shared/scan-names.js";

function parseDeps(section: string, scope: string): Dependency[] {
  const deps: Dependency[] = [];
  for (const line of section.split(/\r?\n/)) {
    const simple = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    const table = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    const m = simple ?? table;
    if (!m) continue;
    deps.push({
      groupId: m[1],
      artifactId: m[1],
      version: m[2],
      scope,
      versionRaw: m[2],
    });
  }
  return deps;
}

export const rustCargoAdapter: LanguageAdapter = {
  id: "rust-cargo",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "Cargo.toml"));
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const text = await fsPromises.readFile(path.join(repoRoot, "Cargo.toml"), "utf8");
    const rustVer = text.match(/rust-version\s*=\s*"(\d+(?:\.\d+)*)"/);
    const deps: Dependency[] = [];
    const depSec = text.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/);
    const devSec = text.match(/\[dev-dependencies\]([\s\S]*?)(?:\n\[|$)/);
    if (depSec) deps.push(...parseDeps(depSec[1], "runtime"));
    if (devSec) deps.push(...parseDeps(devSec[1], "dev"));
    return {
      language: "rust",
      declaredRuntimeVersion: rustVer?.[1] ?? null,
      buildTool: "cargo",
      manifestPath: "Cargo.toml",
      parentResolved: true,
      dependencies: deps,
    };
  },

  async scanImports(repoRoot, deps) {
    return scanDepNames(repoRoot, ["**/*.rs"], deps);
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return cachedFetch(repoRoot, dep.groupId, dep.artifactId, async () => {
      const body = await fetchJson<{ crate?: { max_stable_version?: string; max_version?: string } }>(
        `https://crates.io/api/v1/crates/${encodeURIComponent(dep.artifactId)}`,
        { "user-agent": "ctx-compat-check (https://github.com/ctx)" },
      );
      const latest = body?.crate?.max_stable_version ?? body?.crate?.max_version;
      if (!latest) return null;
      return {
        latestVersion: latest,
        versions: [latest],
        fetchedAt: new Date().toISOString(),
        stale: false,
        available: true,
      };
    });
  },

  defaultTarget(): string | null {
    return null;
  },
};
