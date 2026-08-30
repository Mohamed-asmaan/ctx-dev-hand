import type { CaseFile, Finding, FindingsResult } from "../store/schema.js";

export function lockedDecisions(caseFile: CaseFile | null | undefined) {
  return caseFile?.decisions.filter((d) => d.locked === true) ?? [];
}

/** Locked facts turn a modernization check into STOPPED. */
export function applyLockedGates(
  result: FindingsResult,
  caseFile: CaseFile | null,
): FindingsResult {
  const locked = lockedDecisions(caseFile);
  if (locked.length === 0) return result;

  const extra: Finding[] = locked.map((d) => ({
    id: `lock:${d.id}`,
    class: "C4_technology_decision",
    severity: "blocking",
    dependency: "(locked decision)",
    installed: "recorded as current",
    minimumForTarget: null,
    dependsOn: null,
    evidence: {
      fact: d.fact,
      source: "unknown",
      fetchedAt: d.at,
    },
    reason:
      `LOCKED. Modernizing would cause system failure or behavior drift. ${d.fact}`,
    compatibilityKnown: true,
  }));

  return {
    ...result,
    findings: [...extra, ...result.findings],
    verdict: "blocked",
    summary:
      `STOPPED. ${locked.length} locked decision(s) say this product must keep working as recorded. ` +
      `Modernizing would break those locks. Show every lock and every recorded edge. Wait. ` +
      (result.summary ?? ""),
  };
}
