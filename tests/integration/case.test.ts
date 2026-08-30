import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureCase } from "../../src/commands/capture.js";
import { verifyCase } from "../../src/commands/verify.js";
import { briefCase } from "../../src/commands/brief.js";
import { formatPlainState } from "../../src/output/plain.js";
import { readState } from "../../src/store/state.js";

const SAMPLE = path.resolve("samples/legacy-python-app");
const temps: string[] = [];

async function copySample(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-case-"));
  temps.push(dir);
  await fs.cp(SAMPLE, dir, { recursive: true });
  await fs.rm(path.join(dir, ".ctx", "case.json"), { force: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("capture → verify → brief", () => {
  it("writes a case file and reports same until a tracked file drifts", async () => {
    const dir = await copySample();
    const caseFile = await captureCase(dir, {
      now: "2026-08-30T12:00:00.000Z",
      edges: ["Empty cart returns zero"],
      decisions: ["Original owner: tax is 10 percent in US"],
      by: "owner",
    });

    expect(caseFile.language).toBe("python");
    expect(caseFile.baseline.tests.some((t) => t.path.includes("test_settings"))).toBe(true);
    expect(caseFile.invariants[0]?.description).toBe("Empty cart returns zero");

    const first = await verifyCase(dir);
    expect(first.report.verdict).toBe("same");

    const { text } = await briefCase(dir);
    expect(text).toMatch(/python 2\.7/);
    expect(text).toMatch(/Empty cart returns zero/);
    expect(text).toMatch(/Last verify: same/);

    const settings = path.join(dir, "app", "settings.py");
    const raw = await fs.readFile(settings, "utf8");
    await fs.writeFile(settings, `${raw}\n# drifted\n`, "utf8");

    const second = await verifyCase(dir);
    expect(second.report.verdict).toBe("changed");
    expect(second.caseFile.lastVerify?.verdict).toBe("changed");
  });

  it("project state tells the assistant to capture when there is no case file", async () => {
    const dir = await copySample();
    const state = await readState(dir);
    const text = formatPlainState(state, null);
    expect(text).toMatch(/Case file: none/);
    expect(text).toMatch(/do not invent/i);
  });
});
