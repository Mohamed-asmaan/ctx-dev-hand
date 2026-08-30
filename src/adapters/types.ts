import type { Dependency } from "../store/schema.js";

export interface ImportLocation {
  packageId: string;
  location: string;
}

export interface ManifestData {
  language: string;
  declaredRuntimeVersion: string | null;
  buildTool: string;
  manifestPath: string;
  parentResolved: boolean;
  dependencies: Dependency[];
}

export type RegistryData =
  | {
      found: true;
      groupId: string;
      artifactId: string;
      latestVersion: string;
      versions: string[];
      fetchedAt: string;
      stale: boolean;
      available: boolean;
      deprecated?: boolean | string;
      engines?: Record<string, string>;
      changelogText?: string;
    }
  | { found: false; groupId: string; artifactId: string };

export interface LanguageAdapter {
  id: string;
  detect(repoRoot: string): boolean | Promise<boolean>;
  readManifest(repoRoot: string): Promise<ManifestData>;
  scanImports(repoRoot: string, deps: Dependency[]): Promise<ImportLocation[]>;
  fetchArtifact(repoRoot: string, dep: Dependency): Promise<RegistryData>;
  defaultTarget(declared: string | null): string | null;
}

export const NO_SUPPORTED_PROJECT =
  "no supported project found — no language manifest detected";
