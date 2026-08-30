import { cacheGet, cacheSet } from "../../store/cache.js";
import type { CacheEntry } from "../../store/schema.js";
import type { RegistryData } from "../types.js";

export async function cachedFetch(
  repoRoot: string,
  groupId: string,
  artifactId: string,
  load: () => Promise<Omit<CacheEntry, "groupId" | "artifactId"> | CacheEntry | null>,
): Promise<RegistryData> {
  const cacheKey = `${groupId}:${artifactId}`;
  const cached = await cacheGet(repoRoot, cacheKey);

  if (cached) {
    if (!cached.stale) {
      return { ...(cached as CacheEntry), found: true as const };
    }
    const fresh = await load();
    if (fresh) {
      const entry = { ...fresh, groupId, artifactId } as CacheEntry;
      await cacheSet(repoRoot, cacheKey, entry);
      return { ...entry, found: true as const };
    }
    return { ...(cached as CacheEntry), stale: true, found: true as const };
  }

  const fresh = await load();
  if (!fresh) {
    return { found: false, groupId, artifactId };
  }
  const entry = { ...fresh, groupId, artifactId } as CacheEntry;
  await cacheSet(repoRoot, cacheKey, entry);
  return { ...entry, found: true as const };
}
