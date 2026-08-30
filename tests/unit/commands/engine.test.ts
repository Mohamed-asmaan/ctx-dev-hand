import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runConnect,
  runEngineStart,
  runEngineStop,
  runUnlink,
} from "../../../src/commands/engine.js";
import { readEngine, normalizeRepoPath } from "../../../src/store/engine.js";
import { assertLiveWork, assertEngineRunning } from "../../../src/store/engine.js";
import { CtxError } from "../../../src/store/state.js";
import { isolateEngine, cleanupEngineEnv } from "../../helpers/live-engine.js";
import { writeConfig } from "../../../src/store/config.js";

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

afterEach(async () => {
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("engine start/stop/connect", () => {
  it("start then connect allows live work after on", async () => {
    await isolateEngine();
    const app = await tempDir("ctx-app-");
    await quiet(() => runEngineStart());
    await quiet(() => runConnect(app));
    await writeConfig(app, { schemaVersion: 1, enabled: true });
    await expect(assertLiveWork(app)).resolves.toBe(path.resolve(app));
  });

  it("stop blocks operations even if the project is still enabled", async () => {
    await isolateEngine();
    const app = await tempDir("ctx-app-off-");
    await quiet(() => runEngineStart());
    await quiet(() => runConnect(app));
    await writeConfig(app, { schemaVersion: 1, enabled: true });
    await quiet(() => runEngineStop());
    await expect(assertEngineRunning()).rejects.toMatchObject({ code: "E24" });
    await expect(assertLiveWork(app)).rejects.toMatchObject({ code: "E24" });
  });

  it("connect requires the engine to be running", async () => {
    await isolateEngine();
    const app = await tempDir("ctx-app-wait-");
    await expect(quiet(() => runConnect(app))).rejects.toBeInstanceOf(CtxError);
    await expect(quiet(() => runConnect(app))).rejects.toMatchObject({ code: "E24" });
  });

  it("unlink drops a path; stop keeps the rest of the list", async () => {
    await isolateEngine();
    const a = await tempDir("ctx-a-");
    const b = await tempDir("ctx-b-");
    await quiet(() => runEngineStart());
    await quiet(() => runConnect(a));
    await quiet(() => runConnect(b));
    await quiet(() => runUnlink(a));
    await quiet(() => runEngineStop());
    const engine = await readEngine();
    expect(engine.running).toBe(false);
    expect(engine.connected).toContain(normalizeRepoPath(b));
    expect(engine.connected).not.toContain(normalizeRepoPath(a));
  });

  it("connect rejects a missing path", async () => {
    await isolateEngine();
    await quiet(() => runEngineStart());
    const missing = path.join(os.tmpdir(), "ctx-missing-nope", "no-such-dir");
    await expect(quiet(() => runConnect(missing))).rejects.toMatchObject({ code: "E26" });
  });
});
