import fs from "node:fs/promises";
import path from "node:path";
import { CtxError } from "../../store/state.js";
import type { Dependency } from "../../store/schema.js";
import type { ManifestData } from "../types.js";

function isRange(v: string): boolean {
  if (/[\[\]\(\)*]/.test(v)) return true;
  if (v.includes(" - ")) return true;
  if (v.startsWith(">") || v.startsWith("<")) return true;
  if (v === "latest") return true;
  return false;
}

function stripCaretTilde(v: string): string {
  return v.replace(/^[~^]/, "");
}

function extractRuntimeVersion(enginesNode: unknown): string | null {
  if (typeof enginesNode !== "string" || !enginesNode.trim()) return null;
  const m = enginesNode.match(/(\d+)/);
  return m ? m[1] : enginesNode.trim();
}

interface LockPackages {
  [key: string]: { version?: string } | undefined;
}

function versionFromLock(
  name: string,
  lock: { packages?: LockPackages; dependencies?: Record<string, { version?: string }> },
): string | undefined {
  const fromPackages = lock.packages?.[`node_modules/${name}`]?.version;
  if (fromPackages) return fromPackages;
  return lock.dependencies?.[name]?.version;
}

export async function readManifest(repoRoot: string): Promise<ManifestData> {
  const pkgPath = path.join(repoRoot, "package.json");
  let raw: string;
  try {
    raw = await fs.readFile(pkgPath, "utf8");
  } catch {
    throw new CtxError("E1", `no npm project found at ${repoRoot}`);
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: { node?: string };
  };
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    return {
      language: "node",
      declaredRuntimeVersion: null,
      buildTool: "npm",
      manifestPath: "package.json",
      parentResolved: true,
      dependencies: [],
    };
  }

  let lock: {
    packages?: LockPackages;
    dependencies?: Record<string, { version?: string }>;
  } | null = null;
  try {
    const lockRaw = await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf8");
    lock = JSON.parse(lockRaw) as typeof lock;
  } catch {
    lock = null;
  }

  const dependencies: Dependency[] = [];

  function addDeps(block: Record<string, string> | undefined, scope: string) {
    if (!block) return;
    for (const [name, declared] of Object.entries(block)) {
      if (!name) continue;
      const locked = lock ? versionFromLock(name, lock) : undefined;
      const rawVersion = declared ?? "";
      let version: string;
      if (locked) {
        version = locked;
      } else if (!rawVersion) {
        version = "unresolved";
      } else if (isRange(rawVersion)) {
        version = "range";
      } else {
        version = stripCaretTilde(rawVersion);
      }
      dependencies.push({
        groupId: name,
        artifactId: name,
        version,
        scope,
        versionRaw: rawVersion,
      });
    }
  }

  addDeps(pkg.dependencies, "runtime");
  addDeps(pkg.devDependencies, "dev");

  return {
    language: "node",
    declaredRuntimeVersion: extractRuntimeVersion(pkg.engines?.node),
    buildTool: "npm",
    manifestPath: "package.json",
    parentResolved: true,
    dependencies,
  };
}
