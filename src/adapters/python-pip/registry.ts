import { cacheGet, cacheSet } from "../../store/cache.js";
import type { CacheEntry } from "../../store/schema.js";
import type { RegistryData } from "../types.js";
import { fetchJson } from "../shared/http.js";

const PYPI = "https://pypi.org/pypi/";

interface PyPiInfo {
  version?: string;
  yanked?: boolean;
  description?: string;
}

interface PyPiResponse {
  info?: PyPiInfo;
  releases?: Record<string, unknown[]>;
}

async function fetchFromRegistry(name: string): Promise<CacheEntry | null> {
  const url = `${PYPI}${encodeURIComponent(name)}/json`;
  const body = await fetchJson<PyPiResponse>(url);
  if (!body) return null;

  const latestVersion = body.info?.version;
  const versions = Object.keys(body.releases ?? {});
  if (!latestVersion || versions.length === 0) return null;

  return {
    groupId: name,
    artifactId: name,
    latestVersion,
    versions,
    fetchedAt: new Date().toISOString(),
    stale: false,
    available: true,
    ...(body.info?.yanked ? { deprecated: true } : {}),
    ...(typeof body.info?.description === "string" && body.info.description.trim()
      ? { changelogText: body.info.description }
      : {}),
  };
}

export async function fetchArtifact(repoRoot: string, name: string): Promise<RegistryData> {
  const cacheKey = `${name}:${name}`;
  const cached = await cacheGet(repoRoot, cacheKey);

  if (cached) {
    if (!cached.stale) {
      return { ...(cached as CacheEntry), found: true as const };
    }
    const fresh = await fetchFromRegistry(name);
    if (fresh) {
      await cacheSet(repoRoot, cacheKey, fresh);
      return { ...fresh, found: true as const };
    }
    return { ...(cached as CacheEntry), stale: true, found: true as const };
  }

  const fresh = await fetchFromRegistry(name);
  if (!fresh) {
    return { found: false, groupId: name, artifactId: name };
  }
  await cacheSet(repoRoot, cacheKey, fresh);
  return { ...fresh, found: true as const };
}
