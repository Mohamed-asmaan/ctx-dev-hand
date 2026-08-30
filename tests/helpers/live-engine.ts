import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runConnect, runEngineStart } from "../../src/commands/engine.js";
import { writeConfig } from "../../src/store/config.js";

const engineDirs: string[] = [];

export async function isolateEngine(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-engfile-"));
  engineDirs.push(dir);
  process.env.CTX_ENGINE_FILE = path.join(dir, "engine.json");
  return process.env.CTX_ENGINE_FILE;
}

export async function prepareLiveProject(
  project: string,
  opts: { enabled?: boolean } = {},
): Promise<void> {
  if (!process.env.CTX_ENGINE_FILE) await isolateEngine();
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await runEngineStart();
    await runConnect(project);
  } finally {
    process.stdout.write = write;
  }
  if (opts.enabled) {
    await writeConfig(project, { schemaVersion: 1, enabled: true });
  }
}

export async function cleanupEngineEnv(): Promise<void> {
  delete process.env.CTX_ENGINE_FILE;
  await Promise.all(engineDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
}
