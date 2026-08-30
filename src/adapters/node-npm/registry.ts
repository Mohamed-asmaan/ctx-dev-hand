import { cacheGet, cacheSet } from "../../store/cache.js";
import type { CacheEntry } from "../../store/schema.js";
import type { RegistryData } from "../types.js";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const RETRY_DELAY_MS = 2000;

interface NpmVersionMeta {
  deprecated?: string;
  engines?: { node?: string };
}

interface NpmPackument {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, NpmVersionMeta>;
  readme?: string;
}

async function fetchFromRegistry(name: string): Promise<CacheEntry | null> {
  const url = NPM_REGISTRY + name.split("/").map(encodeURIComponent).join("/");

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      res = await fetch(url);
    } catch {
      return null;
    }
    if (res.status === 429) return null;
  }

  if (!res.ok) return null;

  let body: NpmPackument;
  try {
    body = (await res.json()) as NpmPackument;
  } catch {
    return null;
  }

  const versions = Object.keys(body.versions ?? {});
  if (versions.length === 0) return null;

  const latestVersion = body["dist-tags"]?.latest ?? versions[versions.length - 1];
  const latestMeta = body.versions?.[latestVersion];

  return {
    groupId: name,
    artifactId: name,
    latestVersion,
    versions,
    fetchedAt: new Date().toISOString(),
    stale: false,
    available: true,
    ...(latestMeta?.deprecated ? { deprecated: true } : {}),
    ...(latestMeta?.engines?.node ? { engines: { node: latestMeta.engines.node } } : {}),
    ...(typeof body.readme === "string" && body.readme.trim()
      ? { changelogText: body.readme }
      : {}),
  } as CacheEntry;
}

export async function fetchArtifact(
  repoRoot: string,
  name: string,
): Promise<RegistryData> {
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
