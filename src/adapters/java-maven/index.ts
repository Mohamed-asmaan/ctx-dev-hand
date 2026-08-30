import fs from "node:fs";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { ImportLocation, LanguageAdapter, RegistryData } from "../types.js";
import { readManifest } from "./manifest.js";
import { scanImports as scanJavaImports } from "./imports.js";
import { fetchArtifact as fetchMavenArtifact } from "./registry.js";

export { readManifest } from "./manifest.js";
export { scanImports } from "./imports.js";
export { fetchArtifact } from "./registry.js";

export const javaMavenAdapter: LanguageAdapter = {
  id: "java-maven",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "pom.xml"));
  },

  readManifest,

  async scanImports(repoRoot: string, deps: Dependency[]): Promise<ImportLocation[]> {
    const { importMap } = await scanJavaImports(repoRoot, deps);
    const locations: ImportLocation[] = [];
    for (const [packageId, files] of Object.entries(importMap)) {
      for (const location of files) {
        locations.push({ packageId, location });
      }
    }
    return locations;
  },

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return fetchMavenArtifact(repoRoot, dep.groupId, dep.artifactId);
  },

  defaultTarget(declared: string | null): string | null {
    if (!declared) return null;
    const n = parseInt(declared, 10);
    if (Number.isNaN(n)) return null;
    return String(n + 3);
  },
};
