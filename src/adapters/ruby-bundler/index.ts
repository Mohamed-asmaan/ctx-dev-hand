import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, ManifestData, RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";
import { cachedFetch } from "../shared/registry.js";
import { scanDepNames } from "../shared/scan-names.js";

function parseGemfile(text: string): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const raw = m[2] ?? "";
    deps.push({
      groupId: name,
      artifactId: name,
      version: raw ? raw.replace(/^[~>=<\s]+/, "") : "unresolved",
      scope: "runtime",
      versionRaw: raw,
    });
  }
  return deps;
}

function parseLock(text: string): Map<string, string> {
  const versions = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const spec = line.match(/^\s{4}(\S+)\s+\(([^)]+)\)/);
    if (spec) {
      versions.set(spec[1], spec[2]);
      current = spec[1];
      continue;
    }
    if (current && /^\s{6}/.test(line)) continue;
    current = null;
  }
  return versions;
}

export const rubyBundlerAdapter: LanguageAdapter = {
  id: "ruby-bundler",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "Gemfile"));
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const gemfile = await fsPromises.readFile(path.join(repoRoot, "Gemfile"), "utf8");
    const deps = parseGemfile(gemfile);
    try {
      const lock = parseLock(await fsPromises.readFile(path.join(repoRoot, "Gemfile.lock"), "utf8"));
      for (const dep of deps) {
        const locked = lock.get(dep.artifactId);
        if (locked) dep.version = locked;
      }
    } catch {
      /* no lock */
    }
    const ruby = gemfile.match(/ruby\s+['"](\d+(?:\.\d+)*)['"]/);
    return {
      language: "ruby",
      declaredRuntimeVersion: ruby?.[1] ?? null,
      buildTool: "bundler",
      manifestPath: "Gemfile",
      parentResolved: true,
      dependencies: deps,
    };
  },

  async scanImports(repoRoot, deps) {
    return scanDepNames(repoRoot, ["**/*.rb"], deps);
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return cachedFetch(repoRoot, dep.groupId, dep.artifactId, async () => {
      const body = await fetchJson<{ version?: string }>(
        `https://rubygems.org/api/v1/gems/${encodeURIComponent(dep.artifactId)}.json`,
      );
      if (!body?.version) return null;
      return {
        latestVersion: body.version,
        versions: [body.version],
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
