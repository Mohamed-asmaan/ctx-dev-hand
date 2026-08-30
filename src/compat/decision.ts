import type { Finding, FindingsResult, StateJson, UpgradeStep } from "../store/schema.js";

const INFRA_DOMAINS =
  /^(architecture|cloud|database|infra|infrastructure|kubernetes|k8s|docker|terraform|rewrite|replatform|vendor)$/;

export function evaluateDecision(
  state: StateJson,
  domain: string,
  value: string,
): FindingsResult {
  const now = new Date().toISOString();
  const spec = `${domain}=${value}`;
  const finding: Finding = {
    id: "F1",
    class: "C4_technology_decision",
    severity: "blocking",
    dependency: spec,
    installed: `${state.language}${state.declaredRuntimeVersion ? `@${state.declaredRuntimeVersion}` : ""}`,
    minimumForTarget: null,
    dependsOn: null,
    evidence: {
      fact: `Scanned ${state.dependencies.length} dependencies on ${state.language}/${state.buildTool}. ctx does not invent ${domain} plans.`,
      source: "unknown",
      fetchedAt: now,
    },
    reason:
      `Target ${spec} is a technology decision, not a version upgrade ctx can auto-apply. ` +
      `Current stack: ${state.language} ${state.declaredRuntimeVersion ?? "(undeclared)"} / ${state.buildTool}. ` +
      `Show this plan and wait. Do not guess versions or rewrite from memory.`,
    compatibilityKnown: false,
  };

  const steps: UpgradeStep[] = [
    {
      step: 1,
      action: `Review decision ${spec} against the scanned inventory. ctx does not invent architecture, vendor, or rewrite plans.`,
      kind: "config",
      resolves: [finding.id],
      blockedBy: [],
    },
    {
      step: 2,
      action: INFRA_DOMAINS.test(domain)
        ? `Infrastructure for ${spec} must be applied by a human after explicit confirmation. Never auto-apply.`
        : `If ${spec} requires infrastructure, stop and wait for explicit confirmation. Never auto-apply infrastructure.`,
      kind: "infrastructure",
      resolves: [],
      blockedBy: ["step 1"],
    },
  ];

  return {
    schemaVersion: 1,
    verdict: "manual",
    summary:
      `${state.language} ${state.declaredRuntimeVersion ?? "undeclared"} → ${spec}: ` +
      `ctx will not invent this plan. Read the two steps below and wait. Do not change servers or databases automatically.`,
    findings: [finding],
    upgradeOrder: steps,
    blastRadius: {},
    checkedAt: now,
    notChecked: {
      unresolved: [],
      range: [],
      noRegistry: [],
      noCompatibility: state.dependencies.map((d) => `${d.groupId}:${d.artifactId}`),
    },
  };
}
