import path from "node:path";
import { readState, CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import { readCaseOptional, writeCase } from "../store/case.js";
import { buildCaseFile, type CaptureInput } from "../case/build.js";
import { formatCaptureSummary } from "../case/report.js";

export async function captureCase(
  repoRoot: string,
  input: CaptureInput = {},
) {
  const absRoot = path.resolve(repoRoot);
  const state = await readState(absRoot);
  const previous = await readCaseOptional(absRoot);
  const caseFile = await buildCaseFile(absRoot, state, previous, input);
  await writeCase(absRoot, caseFile);
  return caseFile;
}

export async function runCapture(
  repoRoot: string,
  opts: {
    decision?: string[];
    edge?: string[];
    rule?: string[];
    contract?: string[];
    lock?: string[];
    by?: string;
    replace?: boolean;
  },
): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);
  try {
    const caseFile = await captureCase(absRoot, {
      decisions: opts.decision,
      edges: opts.edge,
      rules: opts.rule,
      contracts: opts.contract,
      locks: opts.lock,
      by: opts.by,
      replace: opts.replace,
    });
    process.stdout.write(`${formatCaptureSummary(caseFile)}\n`);
  } catch (err) {
    if (err instanceof CtxError && err.code === "E16") {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}
