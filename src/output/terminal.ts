// src/output/terminal.ts
// Human-readable report to stdout.

import type { FindingsResult, Finding, UpgradeStep, CaseFile } from "../store/schema.js";
import type { StateJson } from "../store/schema.js";
import { formatCaseGate } from "../case/report.js";

const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const SEP = "─".repeat(60);

function classLabel(cls: Finding["class"]): string {
  switch (cls) {
    case "C1_language_forces_dependency":
      return "This library must be upgraded first";
    case "C2_dependency_drops_database":
      return "The database must be upgraded first";
    case "C3_eol_advisory":
      return "A newer library version exists";
    case "C4_technology_decision":
      return "This needs a person to decide";
    default:
      return "Needs attention";
  }
}

function kindLabel(kind: UpgradeStep["kind"]): string {
  switch (kind) {
    case "infrastructure":
      return "servers / database — a person must do this";
    case "config":
      return "build setting";
    default:
      return "code / library change";
  }
}

function sourceLabel(source: Finding["evidence"]["source"]): string {
  switch (source) {
    case "curated":
      return "from ctx's known list";
    case "registry":
      return "from the package listing";
    case "changelog-inferred":
      return "from the library notes";
    default:
      return "not confirmed";
  }
}

function verdictLine(result: FindingsResult): string {
  switch (result.verdict) {
    case "blocked":
      return (
        RED(BOLD(`STOPPED`)) +
        ` — ${result.findings.filter((f) => f.severity === "blocking").length} problem(s) must be fixed first`
      );
    case "clear":
      return GREEN(BOLD(`OK TO GO`)) + ` — no known problems`;
    case "manual":
      return YELLOW(BOLD(`NEEDS A PERSON`)) + ` — wait; do not change servers or databases automatically`;
    case "partial":
      return YELLOW(BOLD(`MOSTLY READY`)) + ` — follow the steps; some libraries still need a look`;
  }
}

function formatFinding(f: Finding): string {
  const lines: string[] = [];
  const icon = f.severity === "blocking" ? RED("●") : YELLOW("○");
  lines.push(`${icon} ${BOLD(classLabel(f.class))}`);
  lines.push(`  Library    : ${f.dependency}`);
  lines.push(`  You have   : ${f.installed}`);
  if (f.minimumForTarget) {
    lines.push(`  Need at least : ${f.minimumForTarget}`);
  }
  lines.push(`  Why        : ${f.reason}`);
  lines.push(`  ${DIM(`Based on ${sourceLabel(f.evidence.source)}: ${f.evidence.fact}`)}`);
  return lines.join("\n");
}

function formatStep(s: UpgradeStep): string {
  const parts = [`  ${BOLD(`Step ${s.step}`)}: ${s.action}`];
  parts.push(`          ${DIM(kindLabel(s.kind))}`);
  if (s.blockedBy.length > 0) {
    parts.push(`          ${DIM(`Do this after ${s.blockedBy.join(", ")}`)}`);
  }
  return parts.join("\n");
}

export function printReport(
  result: FindingsResult & { c2Skipped?: boolean; c2SkipReason?: string },
  state: StateJson,
  targetVersion?: string,
  targetSpec?: string,
  caseFile?: CaseFile | null,
): void {
  const lines: string[] = [];

  lines.push("");
  lines.push(SEP);
  lines.push(BOLD("ctx upgrade check") + DIM(` — ${new Date(result.checkedAt).toLocaleString()}`));
  if (targetSpec) {
    lines.push(`  Moving to  : ${targetSpec}`);
  } else if (targetVersion) {
    lines.push(`  Moving to  : ${state.language} ${targetVersion}`);
  }
  lines.push(
    `  Today      : ${state.language} ${state.declaredRuntimeVersion ?? "(version not found)"} (${state.buildTool})`,
  );
  lines.push(SEP);
  lines.push("");
  lines.push(verdictLine(result));
  if (result.summary) {
    lines.push("");
    lines.push(BOLD("IN SHORT"));
    lines.push(result.summary);
  }
  lines.push("");

  if (result.verdict === "clear") {
    lines.push(`Looked at ${state.dependencies.length} libraries. Nothing known that would break this upgrade.`);
    lines.push("");
  }

  const blocking = result.findings.filter((f) => f.severity === "blocking");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  if (blocking.length > 0) {
    lines.push(BOLD("FIX THESE FIRST"));
    lines.push(SEP);
    for (const f of blocking) {
      lines.push(formatFinding(f));
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push(BOLD("WORTH A LOOK"));
    lines.push(SEP);
    for (const f of warnings) {
      lines.push(formatFinding(f));
      lines.push("");
    }
  }

  if (result.c2Skipped) {
    lines.push(DIM("No database version is declared in this project, so the database was not checked."));
    lines.push("");
  }

  if (result.upgradeOrder.length > 0) {
    lines.push(BOLD("WHAT TO DO, IN ORDER"));
    lines.push(SEP);
    for (const step of result.upgradeOrder) {
      lines.push(formatStep(step));
    }
    lines.push("");
  }

  const hasBlast = Object.values(result.blastRadius).some((files) => files.length > 0);
  if (hasBlast) {
    lines.push(BOLD("FILES THAT USE THESE LIBRARIES"));
    lines.push(SEP);
    for (const [groupId, files] of Object.entries(result.blastRadius)) {
      if (files.length === 0) continue;
      lines.push(`  ${CYAN(groupId)} — ${files.length} file(s)`);
      for (const f of files) {
        lines.push(`    ${DIM(f)}`);
      }
    }
    lines.push("");
  }

  const nc = result.notChecked;
  const extras: string[] = [];
  if (nc.unresolved.length) {
    extras.push(`Could not read a version for: ${nc.unresolved.join(", ")}`);
  }
  if (nc.range.length) {
    extras.push(`Version is a range (not a single number) for: ${nc.range.join(", ")}`);
  }
  if (nc.noCompatibility.length) {
    extras.push(`ctx has no known rules for: ${nc.noCompatibility.join(", ")}`);
  }
  if (nc.noRegistry.length) {
    extras.push(`Could not reach the package listing for: ${nc.noRegistry.join(", ")}`);
  }
  if (extras.length > 0) {
    lines.push(BOLD("COULD NOT FULLY CHECK"));
    lines.push(SEP);
    for (const extra of extras) {
      lines.push(`  ${extra}`);
    }
    lines.push("");
  }

  lines.push(BOLD("CASE FILE"));
  lines.push(SEP);
  lines.push(formatCaseGate(caseFile ?? null));
  lines.push("");
  lines.push(SEP);
  lines.push("");

  process.stdout.write(lines.join("\n"));
}
