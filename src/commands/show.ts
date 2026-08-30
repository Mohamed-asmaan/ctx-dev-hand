import path from "node:path";
import { CtxError } from "../store/state.js";
import { assertLiveWork } from "../store/engine.js";
import { readCaseOptional } from "../store/case.js";
import { formatCaseGate } from "../case/report.js";
import type { CaseFile } from "../store/schema.js";

export function formatShow(caseFile: CaseFile, file: string): string {
  const lines = [
    "",
    "ctx facts — this is where developer decisions live",
    "─".repeat(57),
    `  file : ${file}`,
    "─".repeat(57),
    formatCaseGate(caseFile),
    "",
    "Scan also stored (inventory, not locks):",
    ...caseFile.decisions
      .filter((d) => d.confirmedBy === "scan")
      .map((d) => `- ${d.fact}`),
    "",
    "Add more (person confirms first):",
    "  ctx capture --lock \"...\" --edge \"...\" --decision \"...\" --rule \"...\"",
    "IBM Bob: call ctx_capture with those arrays. Do not invent them.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function runShow(repoRoot: string): Promise<void> {
  const absRoot = await assertLiveWork(repoRoot);
  const file = path.join(absRoot, ".ctx", "case.json");
  const caseFile = await readCaseOptional(absRoot);
  if (!caseFile) {
    throw new CtxError(
      "E21",
      `No case file at ${file}. Run ctx scan then ctx capture. A person confirms extra facts — do not invent them.`,
    );
  }
  process.stdout.write(formatShow(caseFile, file));
}
