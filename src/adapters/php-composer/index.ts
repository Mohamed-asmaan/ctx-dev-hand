import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, ManifestData, RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";
import { cachedFetch } from "../shared/registry.js";
import { scanDepNames } from "../shared/scan-names.js";

function addBlock(
  block: Record<string, string> | undefined,
  scope: string,
  deps: Dependency[],
): void {
  if (!block) return;
  for (const [name, raw] of Object.entries(block)) {
    if (name === "php" || name.startsWith("ext-")) continue;
    const version = raw.replace(/^[\^~>=<\s]+/, "").split(/\s/)[0] || "unresolved";
    deps.push({
      groupId: name,
      artifactId: name.split("/")[1] ?? name,
      version: /[|]/.test(raw) || raw.includes("*") || raw.startsWith(">") ? "range" : version,
      scope,
      versionRaw: raw,
    });
  }
}

export const phpComposerAdapter: LanguageAdapter = {
  id: "php-composer",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "composer.json"));
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const raw = await fsPromises.readFile(path.join(repoRoot, "composer.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
      config?: { platform?: { php?: string } };
    };
    const deps: Dependency[] = [];
    addBlock(pkg.require, "runtime", deps);
    addBlock(pkg["require-dev"], "dev", deps);
    const php = pkg.require?.php ?? pkg.config?.platform?.php;
    const runtime = php?.match(/(\d+(?:\.\d+)*)/)?.[1] ?? null;
    return {
      language: "php",
      declaredRuntimeVersion: runtime,
      buildTool: "composer",
      manifestPath: "composer.json",
      parentResolved: true,
      dependencies: deps,
    };
  },

  async scanImports(repoRoot, deps) {
    return scanDepNames(repoRoot, ["**/*.php"], deps);
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return cachedFetch(repoRoot, dep.groupId, dep.artifactId, async () => {
      const body = await fetchJson<{ package?: { versions?: Record<string, unknown> } }>(
        `https://repo.packagist.org/packages/${dep.groupId}.json`,
      );
      const versions = Object.keys(body?.package?.versions ?? {}).filter((v) => !v.startsWith("dev-"));
      if (versions.length === 0) return null;
      const latest = versions[0];
      return {
        latestVersion: latest.replace(/^v/, ""),
        versions: versions.map((v) => v.replace(/^v/, "")),
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
