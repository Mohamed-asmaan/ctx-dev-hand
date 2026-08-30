import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../../src/commands/init.js";
import { runRemove } from "../../../src/commands/remove.js";
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

describe("ctx remove", () => {
  it("deletes every ctx file including leftover instructions and truth", async () => {
    const dir = await tempDir("ctx-rm-");
    const home = await tempDir("ctx-rm-cfg-");
    process.env.CTX_CONFIG_HOME = home;
    await prepareLiveProject(dir);
    await quiet(() => runInit(dir));
    await writeState(dir, {
      schemaVersion: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
      language: "node",
      declaredRuntimeVersion: "18",
      buildTool: "npm",
      manifestPath: "package.json",
      parentResolved: false,
      dependencies: [],
      platform: {
        database: { engine: null, version: null, declaredIn: null, confidence: "declared", allFound: [] },
      },
      importMap: {},
    } satisfies StateJson);
    await fs.writeFile(
      path.join(dir, "AGENTS.md"),
      "ctx — required before any modernization\n",
      "utf8",
    );
    await fs.writeFile(path.join(dir, "README.md"), "# app\n", "utf8");

    await quiet(() => runRemove(dir));

    await expect(fs.access(path.join(dir, ".ctx"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "AGENTS.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "rules", "ctx-upgrade-gate.mdc"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "README.md"), "utf8")).toBe("# app\n");
  });
});
