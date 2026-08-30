// src/compat/loader.ts
// Loads data/compatibility.json and provides a typed query interface.
// The engine never reads the file directly — it calls this loader.

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Schema for data/compatibility.json
// ---------------------------------------------------------------------------

export interface CompatConstraint {
  fromVersion: string;
  requires?: Record<string, string>; // e.g. { postgres: ">=10" }
  removed?: string[]; // JDK removal list
  note: string;
  verifiedAt: string;
  sourceUrl: string;
}

export interface CompatEntry {
  key: string; // "groupId:artifactId" or "jdk:removals"
  constraints: CompatConstraint[];
  /** Maps "language:targetVersion" → minimum artifact version required */
  upgradeMap?: Record<string, string>;
}

export interface CompatibilityDb {
  getConstraints(groupId: string, artifactId: string): CompatConstraint[];
  getMinVersionForTarget(
    groupId: string,
    artifactId: string,
    targetLanguage: string,
    targetVersion: string,
  ): string | null;
  getRuntimeRemovals(language: string, version: string): string[];
  getRaw(): CompatEntry[];
}

// ---------------------------------------------------------------------------
// Semver helpers (minimal — avoids pulling in 'semver' package)
// ---------------------------------------------------------------------------

function parseVersion(v: string): number[] {
  // Strips leading operators (>=, >, ^, ~) and returns numeric parts
  return v
    .replace(/^[^0-9]*/, "")
    .split(".")
    .map((part) => parseInt(part.replace(/[^0-9].*/, ""), 10) || 0);
}

export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Returns true if the installed version satisfies a ">=X" requirement */
export function satisfiesRequirement(installed: string, requirement: string): boolean {
  if (requirement.startsWith(">=")) {
    return compareSemver(installed, requirement.slice(2)) >= 0;
  }
  if (requirement.startsWith(">")) {
    return compareSemver(installed, requirement.slice(1)) > 0;
  }
  if (requirement.startsWith("<=")) {
    return compareSemver(installed, requirement.slice(2)) <= 0;
  }
  if (requirement.startsWith("<")) {
    return compareSemver(installed, requirement.slice(1)) < 0;
  }
  // Exact match
  return compareSemver(installed, requirement) === 0;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// Resolve data/ relative to this file's location in the package
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "../../data/compatibility.json");

let cachedDb: CompatibilityDb | null = null;

export function loadCompatibility(): CompatibilityDb {
  if (cachedDb) return cachedDb;

  // Synchronous read — runs once at startup, data file is tiny
  const raw = fs.readFile; // We'll load synchronously below
  void raw; // suppress unused warning

  const fileContent = (() => {
    // Use require for sync load in ESM
    const require = createRequire(import.meta.url);
    try {
      return require(DATA_PATH) as { schemaVersion: number; entries: CompatEntry[] };
    } catch {
      // Fallback: dynamic path resolution
      throw new Error(`Cannot load compatibility data from ${DATA_PATH}`);
    }
  })();

  const entries: CompatEntry[] = fileContent.entries ?? [];

  const byKey = new Map<string, CompatEntry>();
  for (const entry of entries) {
    byKey.set(entry.key, entry);
  }

  cachedDb = {
    getRaw() {
      return entries;
    },

    getConstraints(groupId: string, artifactId: string): CompatConstraint[] {
      const entry =
        byKey.get(`${groupId}:${artifactId}`) ??
        byKey.get(artifactId) ??
        byKey.get(groupId);
      return entry?.constraints ?? [];
    },

    getMinVersionForTarget(
      groupId: string,
      artifactId: string,
      targetLanguage: string,
      targetVersion: string,
    ): string | null {
      const entry =
        byKey.get(`${groupId}:${artifactId}`) ??
        byKey.get(artifactId) ??
        byKey.get(groupId);
      if (!entry?.upgradeMap) return null;
      const prefix = `${targetLanguage}:`;
      let bestLang: string | null = null;
      let bestMin: string | null = null;
      for (const [key, minArt] of Object.entries(entry.upgradeMap)) {
        if (!key.startsWith(prefix)) continue;
        const langVer = key.slice(prefix.length);
        if (compareSemver(targetVersion, langVer) < 0) continue;
        if (bestLang === null || compareSemver(langVer, bestLang) > 0) {
          bestLang = langVer;
          bestMin = minArt;
        }
      }
      return bestMin;
    },

    getRuntimeRemovals(language: string, version: string): string[] {
      const keys = [`${language}:removals`];
      if (language === "java") keys.push("jdk:removals");
      const removed: string[] = [];
      for (const key of keys) {
        const entry = byKey.get(key);
        if (!entry) continue;
        for (const constraint of entry.constraints) {
          if (compareSemver(version, constraint.fromVersion) >= 0) {
            removed.push(...(constraint.removed ?? []));
          }
        }
      }
      return [...new Set(removed)];
    },
  };

  return cachedDb;
}
