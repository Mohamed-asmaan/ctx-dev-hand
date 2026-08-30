import path from "node:path";
import { CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import { readCase } from "../store/case.js";
import { formatBrief } from "../case/report.js";

export async function briefCase(repoRoot: string) {
  const absRoot = path.resolve(repoRoot);
  const caseFile = await readCase(absRoot);
  return { caseFile, text: formatBrief(caseFile) };
}

export async function runBrief(repoRoot: string): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);
  try {
    const { text } = await briefCase(absRoot);
    process.stdout.write(`${text}\n`);
  } catch (err) {
    if (err instanceof CtxError && err.code === "E21") {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}
