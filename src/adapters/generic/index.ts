import fs from "node:fs";
import path from "node:path";
import type { LanguageAdapter, ManifestData } from "../types.js";

const MARKERS: Array<{ file: string; language: string; tool: string }> = [
  { file: "build.gradle", language: "java", tool: "gradle" },
  { file: "build.gradle.kts", language: "kotlin", tool: "gradle" },
  { file: "settings.gradle", language: "java", tool: "gradle" },
  { file: "mix.exs", language: "elixir", tool: "mix" },
  { file: "Package.swift", language: "swift", tool: "spm" },
  { file: "pubspec.yaml", language: "dart", tool: "pub" },
  { file: "CMakeLists.txt", language: "cpp", tool: "cmake" },
  { file: "stack.yaml", language: "haskell", tool: "stack" },
  { file: "deps.edn", language: "clojure", tool: "deps" },
  { file: "project.clj", language: "clojure", tool: "leiningen" },
  { file: "build.sbt", language: "scala", tool: "sbt" },
  { file: "Makefile", language: "c", tool: "make" },
];

function detectMarker(repoRoot: string): { file: string; language: string; tool: string } | null {
  for (const marker of MARKERS) {
    if (fs.existsSync(path.join(repoRoot, marker.file))) return marker;
  }
  return null;
}

export const genericAdapter: LanguageAdapter = {
  id: "generic",

  detect(repoRoot: string): boolean {
    return detectMarker(repoRoot) !== null;
  },

  async readManifest(repoRoot: string): Promise<ManifestData> {
    const marker = detectMarker(repoRoot);
    return {
      language: marker?.language ?? "unknown",
      declaredRuntimeVersion: null,
      buildTool: marker?.tool ?? "unknown",
      manifestPath: marker?.file ?? ".",
      parentResolved: true,
      dependencies: [],
    };
  },

  async scanImports() {
    return [];
  },

  async fetchArtifact(_repoRoot, dep) {
    return { found: false, groupId: dep.groupId, artifactId: dep.artifactId };
  },

  defaultTarget(): string | null {
    return null;
  },
};
