import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, ManifestData, RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";
import { cachedFetch } from "../shared/registry.js";
import { scanDepNames } from "../shared/scan-names.js";

function listProjectFiles(repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && /\.(csproj|fsproj|vbproj)$/i.test(entry.name)) {
        found.push(full);
      } else if (entry.isDirectory() && entry.name !== "bin" && entry.name !== "obj") {
        walk(full, depth + 1);
      }
    }
  };
  walk(repoRoot, 0);
  return found;
}

export const dotnetNugetAdapter: LanguageAdapter = {
  id: "dotnet-nuget",

  detect(repoRoot: string): boolean {
    return listProjectFiles(repoRoot).length > 0;
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const files = listProjectFiles(repoRoot);
    const text = await fsPromises.readFile(files[0], "utf8");
    const tfm = text.match(/<TargetFramework(?:s)?>([^<]+)</);
    const runtime = tfm?.[1]?.match(/(\d+(?:\.\d+)*)/)?.[1] ?? null;
    const deps: Dependency[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const xml = await fsPromises.readFile(file, "utf8");
      for (const m of xml.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        deps.push({
          groupId: m[1],
          artifactId: m[1],
          version: m[2],
          scope: "runtime",
          versionRaw: m[2],
        });
      }
    }
    return {
      language: "dotnet",
      declaredRuntimeVersion: runtime,
      buildTool: "nuget",
      manifestPath: path.relative(repoRoot, files[0]).replace(/\\/g, "/"),
      parentResolved: true,
      dependencies: deps,
    };
  },

  async scanImports(repoRoot, deps) {
    return scanDepNames(repoRoot, ["**/*.{cs,fs,vb}"], deps);
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return cachedFetch(repoRoot, dep.groupId, dep.artifactId, async () => {
      const id = dep.artifactId.toLowerCase();
      const body = await fetchJson<{ versions?: string[] }>(
        `https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(id)}/index.json`,
      );
      const versions = body?.versions ?? [];
      if (versions.length === 0) return null;
      const latest = versions[versions.length - 1];
      return {
        latestVersion: latest,
        versions,
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
