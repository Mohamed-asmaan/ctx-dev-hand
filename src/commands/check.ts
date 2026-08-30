import path from "node:path";
import { selectAdapter, NO_SUPPORTED_PROJECT } from "../adapters/index.js";
import { readState, CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import { readCaseOptional } from "../store/case.js";
import { evaluateChange } from "../compat/evaluate.js";
import { parseTarget } from "../compat/target.js";
import { printReport } from "../output/terminal.js";
import type { StateJson } from "../store/schema.js";

export async function runCheck(
  repoRoot: string,
  options: { target?: string; report?: boolean; reportPath?: string },
): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);

  let state: StateJson;
  try {
    state = await readState(absRoot);
  } catch (err) {
    if (err instanceof CtxError && err.code === "E16") {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const targetSpec = options.target ?? "";
  let parsed = targetSpec ? parseTarget(targetSpec) : null;

  if (targetSpec && !parsed) {
    process.stderr.write(
      `[ctx error] Unrecognised target spec "${targetSpec}". Use --target ${state.language}=<version> or --target <decision>=<value>\n`,
    );
    process.exit(1);
  }

  if (!parsed) {
    const adapter = await selectAdapter(absRoot);
    if (!adapter) {
      process.stderr.write(`[ctx error] ${NO_SUPPORTED_PROJECT}\n`);
      process.exit(2);
    }
    const declared = state.declaredRuntimeVersion;
    const next = adapter.defaultTarget(declared);
    if (next) {
      parsed = { key: state.language, value: next };
      process.stderr.write(
        `[ctx info] No --target specified. Defaulting to ${state.language}=${next} (declared: ${declared})\n`,
      );
    } else {
      process.stderr.write(
        `[ctx error] Cannot determine target. Use --target ${state.language}=<version> or a decision spec\n`,
      );
      process.exit(1);
    }
  }

  let result;
  try {
    result = await evaluateChange(absRoot, parsed);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("E20")) {
      process.stderr.write(`[ctx error] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  printReport(result, state, parsed.value, `${parsed.key}=${parsed.value}`, await readCaseOptional(absRoot));

  if (options.report || options.reportPath) {
    const { writeReport } = await import("../output/markdown.js");
    const reportPath = options.reportPath ?? path.join(absRoot, "ctx-report.md");
    await writeReport(result, state, parsed.value, reportPath);
    console.log(`Report written to ${reportPath}`);
  }

  if (result.verdict === "partial") process.exit(2);
  if (result.verdict === "blocked" || result.verdict === "manual") process.exit(1);
  process.exit(0);
}
