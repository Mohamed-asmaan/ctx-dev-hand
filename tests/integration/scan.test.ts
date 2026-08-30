// tests/integration/scan.test.ts
// Verifies ctx scan against the checked-in sample project.
// This test runs the full scan pipeline — readers + registry (mocked) + state write.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { runScan } from "../../src/commands/scan.js";
import { readState } from "../../src/store/state.js";
import { prepareLiveProject, cleanupEngineEnv } from "../helpers/live-engine.js";

// Registry response fixture — must not make real network calls
const REGISTRY_RESPONSE = JSON.stringify({
  response: {
    numFound: 1,
    docs: [
      { g: "org.postgresql", a: "postgresql", v: "42.7.3", timestamp: 1700000000000 },
    ],
  },
});

const JAXB_RESPONSE = JSON.stringify({
  response: {
    numFound: 1,
    docs: [
      { g: "javax.xml.bind", a: "jaxb-api", v: "2.3.1", timestamp: 1690000000000 },
    ],
  },
});

function makeMockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    const body = url.includes("jaxb") ? JAXB_RESPONSE : REGISTRY_RESPONSE;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(body)),
    });
  });
}

const SAMPLE_PROJECT = path.resolve("samples/legacy-java-app");

describe("runScan (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Copy sample project to a temp dir so tests don't mutate the source
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-scan-int-"));
    await fs.cp(SAMPLE_PROJECT, tmpDir, { recursive: true });
    // Remove any pre-existing state so we test a fresh scan
    await fs.rm(path.join(tmpDir, ".ctx"), { recursive: true, force: true });
    await prepareLiveProject(tmpDir, { enabled: true });
    vi.stubGlobal("fetch", makeMockFetch());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupEngineEnv();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .ctx/state.json after scan", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state).toBeDefined();
    expect(state.schemaVersion).toBe(1);
  });

  it("state.json has correct language and buildTool", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.language).toBe("java");
    expect(state.buildTool).toBe("maven");
  });

  it("state.json has declaredJavaVersion = '8'", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.declaredRuntimeVersion).toBe("8");
  });

  it("state.json has at least 2 dependencies (postgresql + jaxb)", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.dependencies.length).toBeGreaterThanOrEqual(2);
    const groupIds = state.dependencies.map((d) => d.groupId);
    expect(groupIds).toContain("org.postgresql");
    expect(groupIds).toContain("javax.xml.bind");
  });

  it("state.json platform.database is postgres 9.6", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.platform.database?.engine).toBe("postgres");
    expect(state.platform.database?.version).toBe("9.6");
  });

  it("state.json importMap contains org.postgresql", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.importMap["org.postgresql"]).toBeDefined();
    expect(state.importMap["org.postgresql"].length).toBeGreaterThan(0);
  });

  it("state.json importMap contains javax.xml.bind", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(state.importMap["javax.xml.bind"]).toBeDefined();
    expect(state.importMap["javax.xml.bind"].length).toBeGreaterThan(0);
  });

  it("scannedAt is a valid ISO date", async () => {
    await runScan(tmpDir);
    const state = await readState(tmpDir);
    expect(new Date(state.scannedAt).toISOString()).toBe(state.scannedAt);
  });

  it("running scan twice overwrites state.json (idempotent)", async () => {
    await runScan(tmpDir);
    const first = await readState(tmpDir);
    // Small delay to ensure scannedAt differs
    await new Promise((r) => setTimeout(r, 10));
    await runScan(tmpDir);
    const second = await readState(tmpDir);
    // Dependencies should be identical; only scannedAt differs
    expect(second.dependencies.length).toBe(first.dependencies.length);
    expect(second.schemaVersion).toBe(1);
  });
});
