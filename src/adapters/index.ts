import type { LanguageAdapter } from "./types.js";
import { javaMavenAdapter } from "./java-maven/index.js";
import { pythonPipAdapter } from "./python-pip/index.js";
import { goModAdapter } from "./go-mod/index.js";
import { rustCargoAdapter } from "./rust-cargo/index.js";
import { phpComposerAdapter } from "./php-composer/index.js";
import { rubyBundlerAdapter } from "./ruby-bundler/index.js";
import { dotnetNugetAdapter } from "./dotnet-nuget/index.js";
import { nodeNpmAdapter } from "./node-npm/index.js";
import { genericAdapter } from "./generic/index.js";

export type { LanguageAdapter, ManifestData, ImportLocation, RegistryData } from "./types.js";
export { NO_SUPPORTED_PROJECT } from "./types.js";

const ADAPTERS: LanguageAdapter[] = [
  javaMavenAdapter,
  pythonPipAdapter,
  goModAdapter,
  rustCargoAdapter,
  phpComposerAdapter,
  rubyBundlerAdapter,
  dotnetNugetAdapter,
  nodeNpmAdapter,
  genericAdapter,
];

export async function selectAdapter(repoRoot: string): Promise<LanguageAdapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(repoRoot)) return adapter;
  }
  return null;
}

export {
  javaMavenAdapter,
  pythonPipAdapter,
  goModAdapter,
  rustCargoAdapter,
  phpComposerAdapter,
  rubyBundlerAdapter,
  dotnetNugetAdapter,
  nodeNpmAdapter,
  genericAdapter,
};
