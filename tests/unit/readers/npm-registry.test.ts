import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchArtifact } from "../../../src/adapters/node-npm/registry.js";

describe("npm fetchArtifact stores changelogText from packument readme", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-npm-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("readme on the packument is written to cache as changelogText", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            "dist-tags": { latest: "8.0.0" },
            versions: { "8.0.0": { engines: { node: ">=12" } } },
            readme: "Java 11 support requires version 8.0.0",
          }),
      }),
    );

    const result = await fetchArtifact(tmpDir, "pg");
    expect(result.found).toBe(true);
    const cacheFile = path.join(tmpDir, ".ctx", "cache", "pg__pg.json");
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    expect(cached.changelogText).toContain("8.0.0");
  });
});
