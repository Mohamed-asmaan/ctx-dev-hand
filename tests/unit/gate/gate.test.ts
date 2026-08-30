import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareLiveProject, cleanupEngineEnv } from "../../helpers/live-engine.js";
import { runEngineStop } from "../../../src/commands/engine.js";

const HOOK = path.resolve("scripts/ctx-gate.cjs");
const temps: string[] = [];

async function tempCwd(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function runHook(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HOOK], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "";
    child.stdout.on("data", (c) => {
      out += String(c);
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(out || "{}"));
      } catch {
        resolve({});
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

afterEach(async () => {
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("ctx-gate hook", () => {
  it("no-ops on session start when the workspace is not opted in", async () => {
    const cwd = await tempCwd("ctx-gate-off-");
    const res = await runHook({
      hook_event_name: "sessionStart",
      conversation_id: "gate-off-1",
      cwd,
    });
    expect(res.additional_context).toBeUndefined();
    expect(res.continue).toBe(true);
  });

  it("allows Write in a repo that never enabled ctx", async () => {
    const cwd = await tempCwd("ctx-gate-off-w-");
    const res = await runHook({
      hook_event_name: "preToolUse",
      conversation_id: "gate-off-write",
      tool_name: "Write",
      cwd,
    });
    expect(res.permission).toBe("allow");
  });

  it("does not inject extra session text when ctx is live (the short rule is enough)", async () => {
    const cwd = await tempCwd("ctx-gate-on-");
    await prepareLiveProject(cwd, { enabled: true });
    const res = await runHook({
      hook_event_name: "sessionStart",
      conversation_id: "gate-test-1",
      cwd,
    });
    expect(res.additional_context).toBeUndefined();
    expect(res.continue).toBe(true);
  });

  it("tells the model ctx is off when the project is on but the engine is stopped", async () => {
    const cwd = await tempCwd("ctx-gate-engoff-");
    await prepareLiveProject(cwd, { enabled: true });
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runEngineStop();
    } finally {
      process.stdout.write = write;
    }
    const res = await runHook({
      hook_event_name: "sessionStart",
      conversation_id: "gate-eng-off",
      cwd,
    });
    expect(String(res.additional_context)).toMatch(/ctx OFF/);
  });

  it("blocks Write after an upgrade prompt until ctx runs", async () => {
    const id = `gate-test-${Date.now()}`;
    const cwd = await tempCwd("ctx-gate-block-");
    await prepareLiveProject(cwd, { enabled: true });
    await runHook({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: id,
      prompt: "upgrade this java app to 11",
      cwd,
    });
    const denied = await runHook({
      hook_event_name: "preToolUse",
      conversation_id: id,
      tool_name: "Write",
      cwd,
    });
    expect(denied.permission).toBe("deny");
  });
});
