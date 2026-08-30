import { cacheGet, cacheSet } from "../../store/cache.js";
import type { CacheEntry } from "../../store/schema.js";

const MAVEN_SEARCH_URL =
  "https://search.maven.org/solrsearch/select?q=g:%22{g}%22+AND+a:%22{a}%22&core=gav&rows=20&wt=json";

const RETRY_DELAY_MS = 2000;

type ArtifactNotFound = { found: false; groupId: string; artifactId: string };
type ArtifactResult = (CacheEntry & { found: true }) | ArtifactNotFound;

interface MavenDoc {
  g: string;
  a: string;
  v: string;
  timestamp: number;
}

interface MavenSearchResponse {
  response: {
    numFound: number;
    docs: MavenDoc[];
  };
}

async function fetchFromRegistry(
  groupId: string,
  artifactId: string,
): Promise<CacheEntry | null> {
  const url = MAVEN_SEARCH_URL.replace("{g}", encodeURIComponent(groupId)).replace(
    "{a}",
    encodeURIComponent(artifactId),
  );

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

  let body: MavenSearchResponse;
  try {
    body = (await res.json()) as MavenSearchResponse;
  } catch {
    return null;
  }

  const docs = body?.response?.docs ?? [];
  if (docs.length === 0) return null;

  const versionSet = new Set<string>();
  let latestVersion = "";
  let latestTs = 0;

  for (const doc of docs) {
    versionSet.add(doc.v);
    if (doc.timestamp > latestTs) {
      latestTs = doc.timestamp;
      latestVersion = doc.v;
    }
  }

  const changelogText = await fetchChangelogText(groupId, artifactId, latestVersion);

  return {
    groupId,
    artifactId,
    latestVersion,
    versions: Array.from(versionSet),
    fetchedAt: new Date().toISOString(),
    stale: false,
    available: true,
    ...(changelogText ? { changelogText } : {}),
  };
}

async function fetchChangelogText(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<string | undefined> {
  const groupPath = groupId.replace(/\./g, "/");
  const url =
    `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}-changelog.txt`;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const text = await res.text();
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchArtifact(
  repoRoot: string,
  groupId: string,
  artifactId: string,
): Promise<ArtifactResult> {
  const cacheKey = `${groupId}:${artifactId}`;

  const cached = await cacheGet(repoRoot, cacheKey);

  if (cached) {
    if (!cached.stale) {
      return { ...(cached as CacheEntry), found: true };
    }
    const fresh = await fetchFromRegistry(groupId, artifactId);
    if (fresh) {
      await cacheSet(repoRoot, cacheKey, fresh);
      return { ...fresh, found: true };
    }
    return { ...(cached as CacheEntry), stale: true, found: true };
  }

  const fresh = await fetchFromRegistry(groupId, artifactId);
  if (!fresh) {
    return { found: false, groupId, artifactId };
  }

  await cacheSet(repoRoot, cacheKey, fresh);
  return { ...fresh, found: true };
}
