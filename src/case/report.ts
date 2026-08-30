import type { CaseFile, VerifyReport } from "../store/schema.js";

/** Facts the gate must show so AI cannot skip recorded edges. */
export function formatCaseGate(caseFile: CaseFile | null): string {
  if (!caseFile) {
    return [
      "Case file: none",
      "Run ctx capture after scan. A person confirms extra edges — do not invent them.",
    ].join("\n");
  }

  const human = caseFile.decisions.filter((d) => d.confirmedBy !== "scan" && !d.locked);
  const locked = caseFile.decisions.filter((d) => d.locked === true);
  const lines = [
    `Case file: captured ${caseFile.capturedAt}`,
  ];

  if (locked.length > 0) {
    lines.push("LOCKED — modernizing would cause system failure or behavior drift. Do not skip:");
    for (const d of locked) {
      lines.push(`- (locked) ${d.fact}`);
    }
  }

  lines.push("Recorded edges / rules / contracts that must still hold:");
  if (human.length === 0 && caseFile.invariants.length === 0 && locked.length === 0) {
    lines.push("- No extra edges yet. Ask a person. Do not guess.");
  }
  for (const d of human) {
    lines.push(`- (decision) ${d.fact}`);
  }
  for (const inv of caseFile.invariants) {
    lines.push(`- (${inv.kind}) ${inv.description}`);
  }
  if (caseFile.lastVerify) {
    lines.push(`Last verify: ${caseFile.lastVerify.verdict} (${caseFile.lastVerify.at})`);
  } else {
    lines.push("Last verify: never run — call ctx_verify after edits.");
  }
  return lines.join("\n");
}

function verdictLine(report: VerifyReport): string {
  switch (report.verdict) {
    case "same":
      return "SAME — recorded files, libraries, and runtime still match";
    case "changed":
      return "CHANGED — something in the case file drifted";
    case "untested":
      return "UNTESTED — nothing drifted, but some items were never recorded";
  }
}

export function formatVerifyReport(report: VerifyReport, caseFile: CaseFile): string {
  const lines: string[] = [];
  lines.push("ctx verify");
  lines.push(`Case file captured: ${caseFile.capturedAt}`);
  lines.push(`Today: ${caseFile.language} ${caseFile.declaredRuntimeVersion ?? "(version not found)"} (${caseFile.buildTool})`);
  lines.push("");
  lines.push(verdictLine(report));
  lines.push("");
  lines.push("In short");
  lines.push(report.summary);
  lines.push("");

  const drifted = report.diffs.filter((d) => d.status === "changed" || d.status === "missing");
  const untested = report.diffs.filter((d) => d.status === "untested" && d.kind !== "invariant");
  const confirm = report.diffs.filter((d) => d.kind === "invariant");

  if (drifted.length) {
    lines.push("What drifted");
    for (const d of drifted) {
      const extra = d.before && d.after ? ` (${d.before} → ${d.after})` : "";
      lines.push(`- ${d.status.toUpperCase()} ${d.kind} ${d.id}${extra}`);
      if (d.note) lines.push(`  ${d.note}`);
    }
    lines.push("");
  }

  if (untested.length) {
    lines.push("Not in the case file");
    for (const d of untested) {
      lines.push(`- ${d.kind} ${d.id}`);
      if (d.note) lines.push(`  ${d.note}`);
    }
    lines.push("");
  }

  if (confirm.length) {
    lines.push("A person must still confirm");
    for (const d of confirm) {
      lines.push(`- ${d.note ?? d.id}`);
    }
    lines.push("");
  }

  if (report.verdict === "same" && !confirm.length) {
    lines.push("Business logic baseline still matches the file we stored.");
    lines.push("");
  }

  lines.push("Show this report to the user as written. Do not turn it into a technical table.");
  return lines.join("\n");
}

export function formatBrief(caseFile: CaseFile): string {
  const libs = caseFile.baseline.dependencies
    .slice(0, 6)
    .map((d) => `${d.artifactId} ${d.version}`)
    .join(", ");
  const more =
    caseFile.baseline.dependencies.length > 6
      ? ` (+${caseFile.baseline.dependencies.length - 6} more)`
      : "";
  const mustNot = caseFile.invariants.slice(0, 4);
  const last = caseFile.lastVerify
    ? `${caseFile.lastVerify.verdict} (${caseFile.lastVerify.at})`
    : "never run";

  const lines = [
    "ctx brief — from the case file. Do not re-explain the whole repo.",
    `Language: ${caseFile.language} ${caseFile.declaredRuntimeVersion ?? "(not found)"} (${caseFile.buildTool})`,
    `Captured: ${caseFile.capturedAt}`,
    `Libraries: ${libs || "none listed"}${more}`,
    `Decisions recorded: ${caseFile.decisions.length}` +
    (caseFile.decisions.some((d) => d.locked)
      ? ` (${caseFile.decisions.filter((d) => d.locked).length} locked)`
      : ""),
    `Tracked files: ${caseFile.baseline.files.length}  Tests recorded: ${caseFile.baseline.tests.length}`,
    `Last verify: ${last}`,
  ];

  if (mustNot.length) {
    lines.push("Must not skip:");
    for (const inv of mustNot) {
      lines.push(`- (${inv.kind}) ${inv.description}`);
    }
  } else {
    lines.push("Must not skip: (no edges recorded yet — ask a person, do not guess)");
  }

  lines.push("Handoff: give the next person this brief plus .ctx/case.json. Do not invent versions.");
  lines.push("Show this to the user as written.");
  return lines.join("\n");
}

export function formatCaptureSummary(caseFile: CaseFile): string {
  const locked = caseFile.decisions.filter((d) => d.locked).length;
  return [
    "Case file written to .ctx/case.json",
    `Language: ${caseFile.language} ${caseFile.declaredRuntimeVersion ?? "(not found)"}`,
    `Decisions: ${caseFile.decisions.length}  Locked: ${locked}  Edges/rules/contracts: ${caseFile.invariants.length}`,
    `Tracked files: ${caseFile.baseline.files.length}  Tests: ${caseFile.baseline.tests.length}`,
    "",
    "Locked facts block a later modernize check. After edits: ctx verify",
    "Handoff: ctx brief",
  ].join("\n");
}
