import type { FindingsResult, Finding, UpgradeStep, StateJson, CaseFile } from "../store/schema.js";
import { formatCaseGate } from "../case/report.js";
import { lockedDecisions } from "../case/locks.js";

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

function verdictLine(result: FindingsResult): string {
  switch (result.verdict) {
    case "blocked":
      return `STOPPED — ${result.findings.filter((f) => f.severity === "blocking").length} problem(s) must be fixed first`;
    case "clear":
      return "OK TO GO — no known problems";
    case "manual":
      return "NEEDS A PERSON — wait; do not change servers or databases automatically";
    case "partial":
      return "MOSTLY READY — follow the steps; some libraries still need a look";
  }
}

export function formatPlainReport(
  result: FindingsResult & { c2Skipped?: boolean; c2SkipReason?: string },
  state: StateJson,
  targetSpec?: string,
  caseFile?: CaseFile | null,
): string {
  const lines: string[] = [];
  lines.push("ctx upgrade check");
  if (targetSpec) lines.push(`Moving to: ${targetSpec}`);
  lines.push(
    `Today: ${state.language} ${state.declaredRuntimeVersion ?? "(version not found)"} (${state.buildTool})`,
  );
  lines.push("");
  lines.push(verdictLine(result));
  if (result.summary) {
    lines.push("");
    lines.push("In short");
    lines.push(result.summary);
  }
  lines.push("");

  const locked = lockedDecisions(caseFile ?? null);
  if (locked.length > 0) {
    lines.push("LOCKED — modernizing would cause system failure or behavior drift");
    for (const d of locked) {
      lines.push(`- ${d.fact}`);
    }
    lines.push("Recorded edges must still hold after any change. Wait. Do not edit yet.");
    lines.push("");
  }

  const blocking = result.findings.filter((f) => f.severity === "blocking");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  if (blocking.length > 0) {
    lines.push("Fix these first");
    for (const f of blocking) {
      lines.push(`- ${classLabel(f.class)}`);
      lines.push(`  Library: ${f.dependency}`);
      lines.push(`  You have: ${f.installed}`);
      if (f.minimumForTarget) lines.push(`  Need at least: ${f.minimumForTarget}`);
      lines.push(`  Why: ${f.reason}`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("Worth a look");
    for (const f of warnings) {
      lines.push(`- ${classLabel(f.class)}`);
      lines.push(`  Library: ${f.dependency}`);
      lines.push(`  You have: ${f.installed}`);
      if (f.minimumForTarget) lines.push(`  Newer version: ${f.minimumForTarget}`);
      lines.push(`  Why: ${f.reason}`);
    }
    lines.push("");
  }

  if (result.c2Skipped) {
    lines.push("No database version is declared in this project, so the database was not checked.");
    lines.push("");
  }

  if (result.upgradeOrder.length > 0) {
    lines.push("What to do, in order");
    for (const s of result.upgradeOrder) {
      lines.push(`Step ${s.step}: ${s.action}`);
      lines.push(`  (${kindLabel(s.kind)})`);
      if (s.blockedBy.length) lines.push(`  Do this after ${s.blockedBy.join(", ")}`);
    }
    lines.push("");
  }

  const hasBlast = Object.values(result.blastRadius).some((files) => files.length > 0);
  if (hasBlast) {
    lines.push("Files that use these libraries");
    for (const [name, files] of Object.entries(result.blastRadius)) {
      if (!files.length) continue;
      lines.push(`${name}:`);
      for (const file of files) lines.push(`  - ${file}`);
    }
    lines.push("");
  }

  const nc = result.notChecked;
  const extras: string[] = [];
  if (nc.unresolved.length) extras.push(`Could not read a version for: ${nc.unresolved.join(", ")}`);
  if (nc.range.length) extras.push(`Version is a range for: ${nc.range.join(", ")}`);
  if (nc.noCompatibility.length) extras.push(`ctx has no known rules for: ${nc.noCompatibility.join(", ")}`);
  if (nc.noRegistry.length) extras.push(`Could not reach the package listing for: ${nc.noRegistry.join(", ")}`);
  if (extras.length) {
    lines.push("Could not fully check");
    for (const extra of extras) lines.push(`- ${extra}`);
    lines.push("");
  }

  lines.push(formatCaseGate(caseFile ?? null));
  lines.push("");
  lines.push("Show this report to the user as written. Do not turn it into a technical table.");
  return lines.join("\n");
}

export function formatPlainState(state: StateJson, caseFile?: CaseFile | null): string {
  const lines = [
    "This project",
    `Language: ${state.language} (${state.buildTool})`,
    `Version today: ${state.declaredRuntimeVersion ?? "(not found in the build file)"}`,
    `Build file: ${state.manifestPath}`,
    `Database: ${state.platform.database?.engine ? `${state.platform.database.engine} ${state.platform.database.version}` : "none listed"}`,
    "",
    "Developer decisions live in .ctx/case.json. IBM Bob: call ctx_show. Scan inventory is not a lock.",
    "",
    "Libraries",
  ];
  for (const dep of state.dependencies) {
    const ver = dep.version === "unresolved" ? "version not listed" : dep.version;
    lines.push(`- ${dep.groupId}:${dep.artifactId}  ${ver}`);
  }
  lines.push("");
  lines.push(formatCaseGate(caseFile ?? null));
  lines.push("");
  lines.push("Show this to the user as written. Do not turn it into a schema table.");
  return lines.join("\n");
}
