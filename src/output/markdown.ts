import fs from "node:fs/promises";
import type { FindingsResult, Finding, UpgradeStep } from "../store/schema.js";
import type { StateJson } from "../store/schema.js";

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

export async function writeReport(
  result: FindingsResult & { c2Skipped?: boolean; c2SkipReason?: string },
  state: StateJson,
  targetVersion: string | undefined,
  outputPath: string,
): Promise<void> {
  const lines: string[] = [];

  lines.push(`# ctx upgrade report`);
  lines.push("");
  lines.push(`**Project:** ${state.manifestPath}  `);
  lines.push(
    `**Today:** ${state.language} ${state.declaredRuntimeVersion ?? "(version not found)"} (${state.buildTool})  `,
  );
  if (targetVersion) lines.push(`**Moving to:** ${state.language} ${targetVersion}  `);
  lines.push("");
  lines.push(`## In short`);
  lines.push("");
  lines.push(result.summary || result.verdict);
  lines.push("");

  const blocking = result.findings.filter((f) => f.severity === "blocking");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  if (blocking.length > 0) {
    lines.push(`## Fix these first`);
    lines.push("");
    for (const f of blocking) {
      lines.push(`### ${classLabel(f.class)}`);
      lines.push(`- **Library:** \`${f.dependency}\``);
      lines.push(`- **You have:** ${f.installed}`);
      if (f.minimumForTarget) lines.push(`- **Need at least:** ${f.minimumForTarget}`);
      lines.push(`- **Why:** ${f.reason}`);
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push(`## Worth a look`);
    lines.push("");
    for (const f of warnings) {
      lines.push(`### ${classLabel(f.class)}`);
      lines.push(`- **Library:** \`${f.dependency}\``);
      lines.push(`- **You have:** ${f.installed}`);
      if (f.minimumForTarget) lines.push(`- **Newer version:** ${f.minimumForTarget}`);
      lines.push(`- **Why:** ${f.reason}`);
      lines.push("");
    }
  }

  lines.push(`## What to do, in order`);
  lines.push("");
  if (result.upgradeOrder.length === 0) {
    lines.push("No steps were produced.");
  } else {
    for (const s of result.upgradeOrder) {
      lines.push(`**Step ${s.step}:** ${s.action}`);
      lines.push(`- ${kindLabel(s.kind)}`);
      if (s.blockedBy.length) lines.push(`- Do this after ${s.blockedBy.join(", ")}`);
      lines.push("");
    }
  }

  lines.push(`## Files that use these libraries`);
  lines.push("");
  const hasBlast = Object.values(result.blastRadius).some((f) => f.length > 0);
  if (!hasBlast) {
    lines.push("No matching source files were found.");
  } else {
    for (const [groupId, files] of Object.entries(result.blastRadius)) {
      if (!files.length) continue;
      lines.push(`### ${groupId} (${files.length} file(s))`);
      for (const file of files) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }
  }

  const nc = result.notChecked;
  if (nc.unresolved.length + nc.range.length + nc.noRegistry.length + nc.noCompatibility.length > 0) {
    lines.push(`## Could not fully check`);
    lines.push("");
    if (nc.unresolved.length) lines.push(`- Could not read a version for: ${nc.unresolved.join(", ")}`);
    if (nc.range.length) lines.push(`- Version is a range for: ${nc.range.join(", ")}`);
    if (nc.noCompatibility.length) lines.push(`- ctx has no known rules for: ${nc.noCompatibility.join(", ")}`);
    if (nc.noRegistry.length) lines.push(`- Could not reach the package listing for: ${nc.noRegistry.join(", ")}`);
    lines.push("");
  }

  if (result.c2Skipped) {
    lines.push("No database version is declared in this project, so the database was not checked.");
    lines.push("");
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf8");
}
