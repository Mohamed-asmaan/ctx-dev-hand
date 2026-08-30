import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScan } from "../../../src/commands/scan.js";
import { writeState, readState } from "../../../src/store/state.js";
import type { StateJson } from "../../../src/store/schema.js";
import { prepareLiveProject, cleanupEngineEnv } from "../../helpers/live-engine.js";

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const ENGINE_STATE: StateJson = {
  schemaVersion: 1,
  scannedAt: "2020-01-01T00:00:00.000Z",
  language: "java",
  declaredRuntimeVersion: "8",
  buildTool: "maven",
  manifestPath: "pom.xml",
  parentResolved: false,
  dependencies: [],
  platform: { database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] } },
  importMap: {},
};

describe("scan writes only into the target repo", () => {
  it("scanning repo A does not change engine .ctx/state.json", async () => {
    const engine = await tempDir("ctx-engine-");
    const repoA = await tempDir("ctx-repo-a-");
    await writeState(engine, ENGINE_STATE);
    await fs.writeFile(
      path.join(repoA, "package.json"),
      JSON.stringify({ name: "app-a", version: "1.0.0", dependencies: {} }),
      "utf8",
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }),
    }));

    await prepareLiveProject(repoA, { enabled: true });

    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runScan(repoA);
    } finally {
      process.stdout.write = write;
    }

    const engineAfter = await readState(engine);
    expect(engineAfter.language).toBe("java");
    expect(engineAfter.scannedAt).toBe(ENGINE_STATE.scannedAt);
    const aState = await readState(repoA);
    expect(aState.language).toBe("node");
  });
});
