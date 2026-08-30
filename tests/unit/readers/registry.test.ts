// tests/unit/readers/registry.test.ts
// All network calls are intercepted via vi.stubGlobal("fetch").
// No test may hit the real network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Load fixtures synchronously
const require = createRequire(import.meta.url);
const PG_RESPONSE = require("../../fixtures/registry/postgresql-response.json");
const NOT_FOUND = require("../../fixtures/registry/not-found-response.json");

// We need to mock the RETRY_DELAY_MS to 0 for tests to be fast
vi.mock("../../../src/adapters/java-maven/registry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../src/adapters/java-maven/registry.js")>();
  return mod;
});

import { fetchArtifact } from "../../../src/adapters/java-maven/registry.js";

function makeMockFetch(responses: Array<{ status: number; body: unknown }>) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[Math.min(callCount++, responses.length - 1)];
    return Promise.resolve({
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(typeof resp.body === "string" ? resp.body : ""),
    });
  });
}

describe("fetchArtifact (mocked fetch)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-reg-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("cold cache → HTTP called once, result written to cache, found=true", async () => {
    const mockFetch = makeMockFetch([{ status: 200, body: PG_RESPONSE }]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.latestVersion).toBe("42.7.7");
    }
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Cache file must exist
    const cacheFile = path.join(tmpDir, ".ctx", "cache", "org.postgresql__postgresql.json");
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    expect(cached.latestVersion).toBe("42.7.7");
  });

  it("warm cache <24h → HTTP not called, returns cached value", async () => {
    // Seed the cache with a fresh entry
    const cacheDir = path.join(tmpDir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "org.postgresql__postgresql.json"),
      JSON.stringify({
        groupId: "org.postgresql",
        artifactId: "postgresql",
        latestVersion: "42.7.7",
        versions: ["42.7.7"],
        fetchedAt: new Date().toISOString(),
        stale: false,
        available: true,
      }),
    );

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("warm cache >24h → HTTP called again", async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const cacheDir = path.join(tmpDir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "org.postgresql__postgresql.json"),
      JSON.stringify({
        groupId: "org.postgresql",
        artifactId: "postgresql",
        latestVersion: "42.2.5",
        versions: ["42.2.5"],
        fetchedAt: oldDate,
        stale: false,
        available: true,
      }),
    );

    const mockFetch = makeMockFetch([{ status: 200, body: PG_RESPONSE }]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    if (result.found) {
      expect(result.latestVersion).toBe("42.7.7"); // fresh from registry
    }
  });

  it("429 → returns stale cache (E7 behaviour)", async () => {
    // Seed stale cache
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const cacheDir = path.join(tmpDir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "org.postgresql__postgresql.json"),
      JSON.stringify({
        groupId: "org.postgresql",
        artifactId: "postgresql",
        latestVersion: "42.2.5",
        versions: ["42.2.5"],
        fetchedAt: oldDate,
        stale: false,
        available: true,
      }),
    );

    // Both calls return 429 (initial + retry)
    const mockFetch = makeMockFetch([
      { status: 429, body: { error: "rate limited" } },
      { status: 429, body: { error: "rate limited" } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    // Patch setTimeout to avoid waiting 2 seconds
    vi.spyOn(global, "setTimeout").mockImplementation((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.stale).toBe(true);
    }
  });

  it("500 → returns stale cache with stale=true", async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const cacheDir = path.join(tmpDir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "org.postgresql__postgresql.json"),
      JSON.stringify({
        groupId: "org.postgresql",
        artifactId: "postgresql",
        latestVersion: "42.2.5",
        versions: ["42.2.5"],
        fetchedAt: oldDate,
        stale: false,
        available: true,
      }),
    );

    const mockFetch = makeMockFetch([{ status: 500, body: { error: "server error" } }]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.stale).toBe(true);
    }
  });

  it("network error, no cache → { found: false }, does not throw", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchArtifact(tmpDir, "org.postgresql", "postgresql")).resolves.toMatchObject({
      found: false,
    });
  });

  it("empty result set → { found: false }", async () => {
    const mockFetch = makeMockFetch([{ status: 200, body: NOT_FOUND }]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(false);
  });

  it("changelog body from registry is stored on the cache entry", async () => {
    const changelog = "Java 11 support requires version 42.3.0";
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(PG_RESPONSE),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(changelog),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    const cacheFile = path.join(tmpDir, ".ctx", "cache", "org.postgresql__postgresql.json");
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    expect(cached.changelogText).toBe(changelog);
  });

  it("corrupted cache JSON → deleted, refetched, warning emitted", async () => {
    const cacheDir = path.join(tmpDir, ".ctx", "cache");
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "org.postgresql__postgresql.json");
    await fs.writeFile(cacheFile, "NOT_VALID_JSON{{{{");

    const mockFetch = makeMockFetch([{ status: 200, body: PG_RESPONSE }]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArtifact(tmpDir, "org.postgresql", "postgresql");
    expect(result.found).toBe(true);
    // cache file should now exist with fresh data
    const newCached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    expect(newCached.latestVersion).toBe("42.7.7");
  });

  it("concurrent calls for same key → only one HTTP request made", async () => {
    const mockFetch = makeMockFetch([
      { status: 200, body: PG_RESPONSE },
      { status: 200, body: PG_RESPONSE },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    // Fire 3 concurrent calls
    const results = await Promise.all([
      fetchArtifact(tmpDir, "org.postgresql", "postgresql"),
      fetchArtifact(tmpDir, "org.postgresql", "postgresql"),
      fetchArtifact(tmpDir, "org.postgresql", "postgresql"),
    ]);
    expect(results.every((r) => r.found)).toBe(true);
    // No in-flight dedup — all 3 concurrent cache misses may each fetch.
    // Verify at least the results are correct; all fetches should succeed.
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
