import path from "node:path";
import { readState, CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import { readCase, writeCase } from "../store/case.js";
import { compareCase } from "../case/compare.js";
import { snapshotFromDisk } from "../case/snapshot.js";
import { formatVerifyReport } from "../case/report.js";

export async function verifyCase(repoRoot: string) {
  const absRoot = path.resolve(repoRoot);
  const state = await readState(absRoot);
  const caseFile = await readCase(absRoot);
  const current = await snapshotFromDisk(absRoot, state, caseFile);
  const report = compareCase(caseFile, current, new Date().toISOString());
  caseFile.lastVerify = report;
  await writeCase(absRoot, caseFile);
  return { caseFile, report };
}

export async function runVerify(repoRoot: string): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);
  try {
    const { caseFile, report } = await verifyCase(absRoot);
    process.stdout.write(`${formatVerifyReport(report, caseFile)}\n`);
    if (report.verdict === "changed") process.exit(1);
    if (report.verdict === "untested") process.exit(2);
    process.exit(0);
  } catch (err) {
    if (err instanceof CtxError && (err.code === "E16" || err.code === "E21")) {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}
