/**
 * Demoable PoC: capture → gate facts → verify after a change → brief for handoff.
 * Copies the Python 2 sample so the repo is not mutated.
 *
 *   npx tsx scripts/demo-poc.ts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureCase } from "../src/commands/capture.js";
import { verifyCase } from "../src/commands/verify.js";
import { briefCase } from "../src/commands/brief.js";
import { formatCaptureSummary, formatVerifyReport } from "../src/case/report.js";

const SAMPLE = path.resolve("samples/legacy-python-app");

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-demo-"));
  await fs.cp(SAMPLE, dir, { recursive: true });
  await fs.rm(path.join(dir, ".ctx", "case.json"), { force: true });

  console.log(`Demo copy: ${dir}\n`);
  console.log("=== 1. Capture (original owner records the truth) ===\n");
  const captured = await captureCase(dir, {
    decisions: ["Original owner: US tax is 10 percent"],
    edges: ["Empty cart returns zero"],
    rules: ["SECRET_KEY in this sample is the placeholder 'legacy'"],
    by: "original-owner",
  });
  console.log(formatCaptureSummary(captured));

  console.log("\n=== 2. Brief (next person, years later) ===\n");
  const { text: brief } = await briefCase(dir);
  console.log(brief);

  console.log("\n=== 3. Verify before any AI edit ===\n");
  const before = await verifyCase(dir);
  console.log(formatVerifyReport(before.report, before.caseFile));

  console.log("\n=== 4. Simulate an AI edit that drifts a tracked file ===\n");
  const settings = path.join(dir, "app", "settings.py");
  await fs.appendFile(settings, "\nDEBUG = True\n", "utf8");

  console.log("=== 5. Verify after the edit ===\n");
  const after = await verifyCase(dir);
  console.log(formatVerifyReport(after.report, after.caseFile));

  console.log("\nIBM Bob talks; ctx holds the facts. Case file is .ctx/case.json in the demo copy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
