import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../../src/commands/init.js";
import { runOff } from "../../../src/commands/off.js";
import { isCtxEnabled } from "../../../src/store/config.js";
import { writeState } from "../../../src/store/state.js";
import type { StateJson } from "../../../src/store/schema.js";
import { prepareLiveProject, cleanupEngineEnv } from "../../helpers/live-engine.js";

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.CTX_CONFIG_HOME;
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

function sampleState(): StateJson {
  return {
    schemaVersion: 1,
    scannedAt: "2026-01-01T00:00:00.000Z",
    language: "node",
    declaredRuntimeVersion: "18",
    buildTool: "npm",
    manifestPath: "package.json",
    parentResolved: false,
    dependencies: [],
    platform: { database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] } },
    importMap: {},
  };
}

describe("ctx off", () => {
  it("disables this repo and keeps recorded truth", async () => {
    const dir = await tempDir("ctx-off-");
    process.env.CTX_CONFIG_HOME = await tempDir("ctx-off-cfg-");
    await prepareLiveProject(dir);
    await quiet(() => runInit(dir));
    await writeState(dir, sampleState());

    await quiet(() => runOff(dir));

    expect(await isCtxEnabled(dir)).toBe(false);
    await fs.access(path.join(dir, ".ctx", "state.json"));
    await expect(fs.access(path.join(dir, ".ctx", "GATE.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "rules", "ctx-upgrade-gate.mdc"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "skills", "ctx"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "hooks.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".ctx", "hooks", "ctx-gate.cjs"))).rejects.toThrow();
    const mcp = JSON.parse(await fs.readFile(path.join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(mcp.mcpServers.ctx).toBeUndefined();
  });

  it("purge deletes state and cache but leaves the repo disabled", async () => {
    const dir = await tempDir("ctx-purge-");
    process.env.CTX_CONFIG_HOME = await tempDir("ctx-purge-cfg-");
    await prepareLiveProject(dir);
    await quiet(() => runInit(dir));
    await writeState(dir, sampleState());

    await quiet(() => runOff(dir, { purge: true }));

    expect(await isCtxEnabled(dir)).toBe(false);
    await expect(fs.access(path.join(dir, ".ctx", "state.json"))).rejects.toThrow();
  });
});
