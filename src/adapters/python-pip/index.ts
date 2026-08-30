import fs from "node:fs";
import path from "node:path";
import type { Dependency } from "../../store/schema.js";
import type { LanguageAdapter, RegistryData } from "../types.js";
import { readManifest } from "./manifest.js";
import { scanImports } from "./imports.js";
import { fetchArtifact as fetchPypiArtifact } from "./registry.js";

export { readManifest } from "./manifest.js";
export { scanImports } from "./imports.js";
export { fetchArtifact } from "./registry.js";

export const pythonPipAdapter: LanguageAdapter = {
  id: "python-pip",

  detect(repoRoot: string): boolean {
    return (
      fs.existsSync(path.join(repoRoot, "requirements.txt")) ||
      fs.existsSync(path.join(repoRoot, "pyproject.toml"))
    );
  },

  readManifest,
  scanImports,

  async fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData> {
    return fetchPypiArtifact(repoRoot, dep.artifactId);
  },

  defaultTarget(declared: string | null): string | null {
    if (!declared) return null;
    if (declared.startsWith("2")) return "3.11";
    return null;
  },
};
