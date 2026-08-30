import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, ManifestData, RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";
import { cachedFetch } from "../shared/registry.js";
import { scanDepNames } from "../shared/scan-names.js";

function parseGoMod(text: string): { runtime: string | null; deps: Dependency[] } {
  const runtimeMatch = text.match(/^go\s+(\d+(?:\.\d+)*)/m);
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  const requireBlock = [...text.matchAll(/^require\s+\(([\s\S]*?)\)/gm)];
  const singles = [...text.matchAll(/^require\s+(?!\()(\S+)\s+(\S+)/gm)];

  const pairs: Array<{ name: string; version: string }> = [];
  for (const block of requireBlock) {
    for (const line of block[1].split(/\r?\n/)) {
      const trimmed = line.replace(/\/\/.*$/, "").trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) pairs.push({ name: parts[0], version: parts[1] });
    }
  }
  for (const m of singles) {
    pairs.push({ name: m[1], version: m[2] });
  }

  for (const { name, version } of pairs) {
    if (seen.has(name)) continue;
    seen.add(name);
    deps.push({
      groupId: name,
      artifactId: name.split("/").pop() ?? name,
      version: version.replace(/^v/, ""),
      scope: "runtime",
      versionRaw: version,
    });
  }

  return { runtime: runtimeMatch?.[1] ?? null, deps };
}

export const goModAdapter: LanguageAdapter = {
  id: "go-mod",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "go.mod"));
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const text = await fsPromises.readFile(path.join(repoRoot, "go.mod"), "utf8");
    const { runtime, deps } = parseGoMod(text);
    return {
      language: "go",
      declaredRuntimeVersion: runtime,
      buildTool: "go",
      manifestPath: "go.mod",
      parentResolved: true,
      dependencies: deps,
    };
  },

  async scanImports(repoRoot, deps) {
    return scanDepNames(repoRoot, ["**/*.go"], deps);
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return cachedFetch(repoRoot, dep.groupId, dep.artifactId, async () => {
      const encoded = dep.groupId.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
      const body = await fetchJson<{ Version?: string }>(
        `https://proxy.golang.org/${encoded}/@latest`,
      );
      if (!body?.Version) return null;
      return {
        latestVersion: body.Version.replace(/^v/, ""),
        versions: [body.Version.replace(/^v/, "")],
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
