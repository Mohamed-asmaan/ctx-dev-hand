import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isCtxEnabled,
  isCtxEnabledSync,
  readConfig,
  writeConfig,
} from "../../../src/store/config.js";

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-cfg-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("ctx project config", () => {
  it("is off when config.json is missing", async () => {
    const dir = await tempDir();
    expect(await isCtxEnabled(dir)).toBe(false);
    expect(isCtxEnabledSync(dir)).toBe(false);
    expect(await readConfig(dir)).toBeNull();
  });

  it("is on only when enabled is true", async () => {
    const dir = await tempDir();
    await writeConfig(dir, { schemaVersion: 1, enabled: true });
    expect(await isCtxEnabled(dir)).toBe(true);
    expect(isCtxEnabledSync(dir)).toBe(true);
    await writeConfig(dir, { schemaVersion: 1, enabled: false });
    expect(await isCtxEnabled(dir)).toBe(false);
  });
});
