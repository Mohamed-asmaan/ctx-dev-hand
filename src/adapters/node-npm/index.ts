import fs from "node:fs";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, RegistryData } from "../types.js";
import { readManifest } from "./manifest.js";
import { scanImports } from "./imports.js";
import { fetchArtifact as fetchNpmArtifact } from "./registry.js";

export { readManifest } from "./manifest.js";
export { scanImports } from "./imports.js";
export { fetchArtifact } from "./registry.js";

export const nodeNpmAdapter: LanguageAdapter = {
  id: "node-npm",

  detect(repoRoot: string): boolean {
    return fs.existsSync(path.join(repoRoot, "package.json"));
  },

  readManifest,
  scanImports,

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return fetchNpmArtifact(repoRoot, dep.artifactId);
  },

  defaultTarget(): string | null {
    return null;
  },
};
