import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireWorkspace } from "../../../src/mcp/workspace.js";
import { writeConfig } from "../../../src/store/config.js";
import { CtxError } from "../../../src/store/state.js";
import { prepareLiveProject, isolateEngine, cleanupEngineEnv } from "../../helpers/live-engine.js";
import { runEngineStop } from "../../../src/commands/engine.js";

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-ws-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("requireWorkspace", () => {
  it("refuses when repoRoot is omitted", async () => {
    await expect(requireWorkspace(undefined)).rejects.toMatchObject({
      code: "E23",
    });
    await expect(requireWorkspace("")).rejects.toMatchObject({ code: "E23" });
  });

  it("refuses when the engine is off", async () => {
    const dir = await tempDir();
    await prepareLiveProject(dir, { enabled: true });
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runEngineStop();
    } finally {
      process.stdout.write = write;
    }
    await expect(requireWorkspace(dir)).rejects.toMatchObject({ code: "E24" });
  });

  it("refuses when the path is not connected", async () => {
    const dir = await tempDir();
    await isolateEngine();
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      const { runEngineStart } = await import("../../../src/commands/engine.js");
      await runEngineStart();
    } finally {
      process.stdout.write = write;
    }
    await writeConfig(dir, { schemaVersion: 1, enabled: true });
    await expect(requireWorkspace(dir)).rejects.toMatchObject({ code: "E25" });
  });

  it("refuses when the repo is not opted in", async () => {
    const dir = await tempDir();
    await prepareLiveProject(dir);
    await expect(requireWorkspace(dir)).rejects.toMatchObject({ code: "E22" });
    try {
      await requireWorkspace(dir);
    } catch (err) {
      expect(err).toBeInstanceOf(CtxError);
      expect(String(err)).toMatch(/ctx is off/);
    }
  });

  it("accepts an opted-in connected project while the engine is running", async () => {
    const dir = await tempDir();
    await prepareLiveProject(dir, { enabled: true });
    await expect(requireWorkspace(dir)).resolves.toBe(path.resolve(dir));
  });
});

describe("MCP tools never bind engine cwd", () => {
  it("source does not fall back to defaultRoot or process.cwd() as repoRoot", async () => {
    const mcpDir = path.resolve("src/mcp");
    const files = [
      "server.ts",
      "tools/project-state.ts",
      "tools/check-change.ts",
      "tools/upgrade-plan.ts",
      "tools/verify-step.ts",
      "tools/capture.ts",
      "tools/brief.ts",
      "tools/verify-baseline.ts",
    ];
    for (const rel of files) {
      const text = await fs.readFile(path.join(mcpDir, rel), "utf8");
      expect(text, rel).not.toContain("?? defaultRoot");
      expect(text, rel).not.toMatch(/repoRoot.*=.*process\.cwd\(\)/);
    }
    const cli = await fs.readFile(path.resolve("src/mcp-cli.ts"), "utf8");
    expect(cli).not.toContain("process.argv[2]");
    expect(cli).not.toContain("process.cwd()");
  });
});
