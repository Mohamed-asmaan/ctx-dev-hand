// src/store/cache.ts
// Read/write helpers for .ctx/cache/<key>.json.
// Cache key format: "<groupId>:<artifactId>"
// Colons are replaced with "__" on disk, e.g. org.postgresql__postgresql.json

import fs from "node:fs/promises";
import path from "node:path";
import type { CacheEntry } from "./schema.js";

const CTX_DIR = ".ctx";
const CACHE_DIR = "cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function keyToFilename(key: string): string {
  return key.replace(/:/g, "__") + ".json";
}

function cachePath(repoRoot: string, key: string): string {
  return path.join(repoRoot, CTX_DIR, CACHE_DIR, keyToFilename(key));
}

export async function cacheGet(
  repoRoot: string,
  key: string,
): Promise<CacheEntry | null> {
  const filePath = cachePath(repoRoot, key);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    // File absent — cache miss
    return null;
  }

  let entry: CacheEntry;
  try {
    entry = JSON.parse(raw) as CacheEntry;
  } catch {
    // Corrupt cache file — delete and treat as miss (E17)
    await fs.unlink(filePath).catch(() => undefined);
    return null;
  }

  const ageMs = Date.now() - new Date(entry.fetchedAt).getTime();
  if (ageMs > CACHE_TTL_MS) {
    return { ...entry, stale: true };
  }

  return entry;
}

export async function cacheSet(
  repoRoot: string,
  key: string,
  value: CacheEntry,
): Promise<void> {
  const cacheDir = path.join(repoRoot, CTX_DIR, CACHE_DIR);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cachePath(repoRoot, key), JSON.stringify(value, null, 2), "utf8");
}
