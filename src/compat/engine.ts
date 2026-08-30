// src/compat/engine.ts
// The constraint engine: pure functions over readers' output.
// No I/O. No model calls. Receives all inputs as arguments.

import { compareSemver, satisfiesRequirement } from "./loader.js";
import type { CompatibilityDb, CompatConstraint } from "./loader.js";
import { parseChangelog } from "./changelog.js";
import type { StateJson, Finding, UpgradeStep, FindingsResult, Verdict, NotChecked, StepKind } from "../store/schema.js";

export type ChangelogTextMap = Record<string, string | undefined | null>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let findingCounter = 0;
function nextId(): string {
  return `F${++findingCounter}`;
}

function resetCounter(): void {
  findingCounter = 0;
}

/** Parse ">=X" requirement string and return the minimum version number */
function minVersionFromRequirement(req: string): string {
  return req.replace(/^[><=]+=?/, "").trim();
}

/** Given a declared db version (e.g. "9.6") and a requirement (e.g. ">=10"),
 *  returns true if the declared version does NOT meet the requirement. */
function dbVersionViolatesRequirement(declared: string, requirement: string): boolean {
  return !satisfiesRequirement(declared, requirement);
}

// ---------------------------------------------------------------------------
// C1: language forces dependency upgrade
// ---------------------------------------------------------------------------

/**
 * For each dependency, check whether the installed version is compatible
 * with the target Java version.
 *
 * Also checks runtime removals: if a package removed in the target runtime is
 * imported by the project (via importMap), emit a blocking finding.
 *
 * E20: if targetVersion < state.declaredRuntimeVersion, throws.
 */
export function runC1(
  state: StateJson,
  targetVersion: string,
  compatDb: CompatibilityDb,
  changelogMap: ChangelogTextMap = {},
): Finding[] {
  // E20: downgrade not supported
  if (
    state.declaredRuntimeVersion !== null &&
    compareSemver(targetVersion, state.declaredRuntimeVersion) < 0
  ) {
    throw new Error(
      `E20: downgrade analysis is not supported (declared: ${state.declaredRuntimeVersion}, target: ${targetVersion})`,
    );
  }

  const findings: Finding[] = [];
  const now = new Date().toISOString();

  // Check each concrete dependency
  for (const dep of state.dependencies) {
    if (dep.version === "unresolved" || dep.version === "range") continue;

    // Does this dep have an upgradeMap entry telling us the minimum version for the target?
    const minRequired = compatDb.getMinVersionForTarget(
      dep.groupId,
      dep.artifactId,
      state.language,
      targetVersion,
    );

    if (minRequired && compareSemver(dep.version, minRequired) < 0) {
      const constraints = compatDb.getConstraints(dep.groupId, dep.artifactId);
      const relevantConstraint = constraints.find(
        (c) =>
          compareSemver(minRequired, c.fromVersion) >= 0 &&
          c.requires?.[state.language] !== undefined,
      );

      findings.push({
        id: nextId(),
        class: "C1_language_forces_dependency",
        severity: "blocking",
        dependency: `${dep.groupId}:${dep.artifactId}`,
        installed: dep.version,
        minimumForTarget: minRequired,
        dependsOn: null,
        evidence: {
          fact: relevantConstraint?.note ??
            `${dep.groupId}:${dep.artifactId} ${dep.version} is not compatible with ${state.language} ${targetVersion}`,
          source: "curated",
          fetchedAt: now,
        },
        reason: `The installed version (${dep.version}) predates ${state.language} ${targetVersion} support. Moving the language to ${targetVersion} forces the dependency forward to at least ${minRequired}.`,
        compatibilityKnown: true,
      });
      continue;
    }

    if (minRequired) continue;

    const constraints = compatDb.getConstraints(dep.groupId, dep.artifactId);
    if (constraints.length > 0) continue;

    const key = `${dep.groupId}:${dep.artifactId}`;
    const inferred = parseChangelog(changelogMap[key], state.language, targetVersion);
    if (
      inferred.parseable &&
      inferred.minVersion &&
      compareSemver(dep.version, inferred.minVersion) < 0
    ) {
      findings.push({
        id: nextId(),
        class: "C1_language_forces_dependency",
        severity: "blocking",
        dependency: key,
        installed: dep.version,
        minimumForTarget: inferred.minVersion,
        dependsOn: null,
        evidence: {
          fact: inferred.note,
          source: "changelog-inferred",
          fetchedAt: now,
        },
        reason: `The installed version (${dep.version}) predates ${state.language} ${targetVersion} support. Moving the language to ${targetVersion} forces the dependency forward to at least ${inferred.minVersion}.`,
        compatibilityKnown: true,
      });
    }
  }

  const removedPackages = compatDb.getRuntimeRemovals(state.language, targetVersion);
  const removalsConstraint = compatDb.getRaw()
    .flatMap((e) => e.constraints)
    .find(
      (c) => compareSemver(targetVersion, c.fromVersion) >= 0 && (c.removed?.length ?? 0) > 0,
    );

  for (const dep of state.dependencies) {
    if (dep.version === "unresolved" || dep.version === "range") continue;
    // Does this dep's groupId match any removed package prefix?
    const matchedRemoval = removedPackages.find(
      (pkg) => dep.groupId.startsWith(pkg) || pkg.startsWith(dep.groupId),
    );
    if (matchedRemoval) {
      findings.push({
        id: nextId(),
        class: "C1_language_forces_dependency",
        severity: "blocking",
        dependency: `${dep.groupId}:${dep.artifactId}`,
        installed: dep.version,
        minimumForTarget: null,
        dependsOn: null,
        evidence: {
          fact: removalsConstraint?.note ??
            `${dep.groupId} was removed from the ${state.language} runtime in ${targetVersion}`,
          source: "curated",
          fetchedAt: now,
        },
        reason: `This package was bundled in the runtime through ${state.language} ${parseInt(targetVersion, 10) - 1}. In ${state.language} ${targetVersion} it must be declared as an explicit dependency or the build will fail.`,
        compatibilityKnown: true,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// C2: dependency upgrade drops database support
// ---------------------------------------------------------------------------

/**
 * For each C1 finding that forces a dependency to a new version,
 * check whether the new version requires a database version higher than declared.
 *
 * E5: if state.platform.database is null, returns [] with a note.
 */
export function runC2(
  state: StateJson,
  c1Findings: Finding[],
  compatDb: CompatibilityDb,
): { findings: Finding[]; skipped: boolean; skipReason?: string } {
  const db = state.platform.database;

  // E5
  if (!db?.engine || !db?.version) {
    return {
      findings: [],
      skipped: true,
      skipReason: "No database version is declared in this project, so the database was not checked.",
    };
  }

  const findings: Finding[] = [];
  const now = new Date().toISOString();

  for (const c1 of c1Findings) {
    if (c1.class !== "C1_language_forces_dependency" || !c1.minimumForTarget) continue;

    // The dependency will be upgraded to c1.minimumForTarget
    const [groupId, artifactId] = c1.dependency.split(":");
    const constraints = compatDb.getConstraints(groupId, artifactId);

    for (const constraint of constraints) {
      // Only check constraints that apply at the new (minimum) version
      if (compareSemver(c1.minimumForTarget, constraint.fromVersion) < 0) continue;

      const dbRequirement = constraint.requires?.[db.engine];
      if (!dbRequirement) continue;

      // Does our declared database version satisfy the requirement?
      if (dbVersionViolatesRequirement(db.version, dbRequirement)) {
        const minDbVersion = minVersionFromRequirement(dbRequirement);
        findings.push({
          id: nextId(),
          class: "C2_dependency_drops_database",
          severity: "blocking",
          dependency: `${groupId}:${artifactId}@${c1.minimumForTarget}`,
          installed: db.version,
          minimumForTarget: minDbVersion,
          dependsOn: c1.id,
          evidence: {
            fact: constraint.note,
            source: "curated",
            fetchedAt: now,
          },
          reason: `Upgrading the driver to ${c1.minimumForTarget} (required to satisfy ${c1.id}) drops support for ${db.engine} ${db.version}. The database must be upgraded to ${minDbVersion} or later before the driver is upgraded.`,
          compatibilityKnown: true,
        });
      }
    }
  }

  return { findings, skipped: false };
}

// ---------------------------------------------------------------------------
// C3: EOL and advisories
// ---------------------------------------------------------------------------

export interface RegistryDataMap {
  [depKey: string]: { latestVersion?: string; stale?: boolean; available?: boolean };
}

export function runC3(
  state: StateJson,
  registryData: RegistryDataMap,
): Finding[] {
  const findings: Finding[] = [];
  const now = new Date().toISOString();

  for (const dep of state.dependencies) {
    if (dep.version === "unresolved" || dep.version === "range") continue;

    const key = `${dep.groupId}:${dep.artifactId}`;
    const reg = registryData[key];
    if (!reg || !reg.available || !reg.latestVersion) continue;

    // If installed === latest, nothing to flag
    if (compareSemver(dep.version, reg.latestVersion) >= 0) continue;

    // For C3 MVP: flag as 'warning' if newer version exists
    // (A more complete implementation would check advisories API and EOL dates)
    findings.push({
      id: nextId(),
      class: "C3_eol_advisory",
      severity: "warning",
      dependency: key,
      installed: dep.version,
      minimumForTarget: reg.latestVersion,
      dependsOn: null,
      evidence: {
        fact: `Latest available version is ${reg.latestVersion}`,
        source: "registry",
        fetchedAt: now,
      },
      reason: `A newer version of ${key} is available (${reg.latestVersion}). Review the changelog before upgrading.`,
      compatibilityKnown: true,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Upgrade order resolver
// ---------------------------------------------------------------------------

/**
 * Topologically sorts findings by their dependsOn edges and produces
 * an ordered step list.
 *
 * E12: if a cycle is detected, returns [] and sets verdict to "manual".
 */
export interface ResolveOrderResult {
  steps: UpgradeStep[];
  cycle: string[] | null;
}

export function resolveOrder(findings: Finding[], targetVersion: string, language = "runtime"): ResolveOrderResult {
  // Only blocking findings participate in the upgrade order.
  // A language bump is always emitted so a check is never an empty plan.
  const blocking = findings.filter((f) => f.severity === "blocking");
  if (blocking.length === 0) {
    return {
      steps: [
        {
          step: 1,
          action: `Set ${language} version to ${targetVersion}`,
          kind: "config",
          resolves: [],
          blockedBy: [],
        },
      ],
      cycle: null,
    };
  }

  // Build adjacency: findingId → list of findingIds whose FIX must come first.
  //
  // The `dependsOn` field means "this finding was CAUSED BY the other finding".
  // For the upgrade order, the fix for a C2 finding (e.g. upgrade DB) must
  // happen BEFORE the C1 fix that triggered it (e.g. upgrade driver).
  // So if C2.dependsOn = C1, then in the step order: C2_fix must precede C1_fix.
  // That means C1 has a prerequisite of C2 in step ordering.
  const prereqs = new Map<string, Set<string>>();
  for (const f of blocking) {
    if (!prereqs.has(f.id)) prereqs.set(f.id, new Set());
  }
  for (const f of blocking) {
    if (f.dependsOn) {
      // f was caused by f.dependsOn → fix f BEFORE fixing f.dependsOn
      // i.e. f.dependsOn's fix requires f's fix to be done first
      if (!prereqs.has(f.dependsOn)) prereqs.set(f.dependsOn, new Set());
      prereqs.get(f.dependsOn)!.add(f.id);
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // id → ids that depend on it

  for (const f of blocking) {
    inDegree.set(f.id, 0);
    dependents.set(f.id, []);
  }

  for (const [id, pset] of prereqs) {
    for (const prereq of pset) {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      if (!dependents.has(prereq)) dependents.set(prereq, []);
      dependents.get(prereq)!.push(id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  // E12: cycle detection
  if (sorted.length !== blocking.length) {
    const cycle = blocking.map((f) => f.id).filter((id) => !sorted.includes(id));
    return { steps: [], cycle };
  }

  // Build human-readable steps
  const findingById = new Map(blocking.map((f) => [f.id, f]));
  const steps: UpgradeStep[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const f = findingById.get(sorted[i])!;
    const stepNum = i + 1;

    let action: string;
    let kind: StepKind;
    if (f.class === "C2_dependency_drops_database") {
      const [, depPart] = f.dependency.split(":");
      const engine = f.installed;
      action = `Upgrade database ${depPart?.split("@")[0] ?? f.dependency.split(":")[0]} from ${engine} to ${f.minimumForTarget} or later`;
      kind = "infrastructure";
    } else if (f.class === "C1_language_forces_dependency" && f.minimumForTarget) {
      action = `Upgrade ${f.dependency} from ${f.installed} to ${f.minimumForTarget}`;
      kind = "code";
    } else if (f.class === "C1_language_forces_dependency") {
      action = `Add ${f.dependency} as an explicit dependency (removed from the runtime)`;
      kind = "code";
    } else {
      action = `Address finding ${f.id}: ${f.reason.slice(0, 80)}...`;
      kind = "code";
    }

    // Which step numbers must be done first?
    const blockedBy: string[] = [];
    for (const prereqId of prereqs.get(f.id) ?? []) {
      const prereqStep = sorted.indexOf(prereqId) + 1;
      if (prereqStep > 0) blockedBy.push(`step ${prereqStep}`);
    }

    steps.push({
      step: stepNum,
      action,
      kind,
      resolves: [f.id],
      blockedBy,
    });
  }

  steps.push({
    step: steps.length + 1,
    action: `Set ${language} version to ${targetVersion}`,
    kind: "config",
    resolves: [],
    blockedBy: steps.map((s) => `step ${s.step}`),
  });

  return { steps, cycle: null };
}

function withReviewSteps(
  steps: UpgradeStep[],
  notChecked: NotChecked,
  language: string,
  targetVersion: string,
): UpgradeStep[] {
  const reviewKeys = [...new Set([...notChecked.unresolved, ...notChecked.noCompatibility])];
  if (reviewKeys.length === 0) return steps;

  const bump = steps.filter((s) => s.kind === "config" && s.action.startsWith("Set "));
  const work = steps.filter((s) => !bump.includes(s));
  const reviews: UpgradeStep[] = reviewKeys.map((key, i) => ({
    step: work.length + i + 1,
    action: `Check whether ${key} works with ${language} ${targetVersion} (ctx does not have a known rule — do not guess)`,
    kind: "code",
    resolves: [],
    blockedBy: work.map((s) => `step ${s.step}`),
  }));
  const renumberedBump = bump.map((s, i) => ({
    ...s,
    step: work.length + reviews.length + i + 1,
    blockedBy: [
      ...work.map((w) => `step ${w.step}`),
      ...reviews.map((r) => `step ${r.step}`),
    ],
  }));
  return [...work, ...reviews, ...renumberedBump];
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export function buildBlastRadius(
  findings: Finding[],
  importMap: Record<string, string[]>,
): Record<string, string[]> {
  const radius: Record<string, string[]> = {};
  for (const f of findings) {
    const groupId = f.dependency.split(":")[0];
    if (groupId && importMap[groupId]) {
      radius[groupId] = importMap[groupId];
    }
  }
  return radius;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function buildSummary(
  state: StateJson,
  targetVersion: string,
  verdict: Verdict,
  blockingCount: number,
  unevaluated: number,
  steps: UpgradeStep[],
): string {
  const from = state.declaredRuntimeVersion ?? "undeclared";
  const bump = `${state.language} ${from} → ${targetVersion}`;
  const last = steps[steps.length - 1];
  if (verdict === "blocked") {
    return (
      `${bump}: ${blockingCount} problem(s) must be fixed first. Follow the steps in order. ` +
      `Do not change servers or databases unless a person confirms.`
    );
  }
  if (verdict === "manual") {
    return `${bump}: needs a human decision. Show the plan and wait.`;
  }
  if (verdict === "partial") {
    return (
      `${bump}: no known blockers, but ${unevaluated} libraries were not proven. ` +
      `Do the review steps, then ${last?.action ?? `set ${state.language} to ${targetVersion}`}.`
    );
  }
  return (
    `${bump}: no known conflicts. Next: ${last?.action ?? `set ${state.language} to ${targetVersion}`} ` +
    `in the build file.`
  );
}

export function runEngine(
  state: StateJson,
  targetVersion: string,
  compatDb: CompatibilityDb,
  registryData: RegistryDataMap,
  changelogMap: ChangelogTextMap = {},
): FindingsResult & { c2Skipped?: boolean; c2SkipReason?: string } {
  resetCounter();

  let c1Findings: Finding[];
  try {
    c1Findings = runC1(state, targetVersion, compatDb, changelogMap);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("E20")) {
      throw err; // propagate downgrade error
    }
    throw err;
  }

  const { findings: c2Findings, skipped: c2Skipped, skipReason: c2SkipReason } = runC2(
    state,
    c1Findings,
    compatDb,
  );
  const c3Findings = runC3(state, registryData);

  const allFindings = [...c1Findings, ...c2Findings, ...c3Findings];
  const blockingCount = allFindings.filter((f) => f.severity === "blocking").length;

  const { steps: ordered, cycle } = resolveOrder(allFindings, targetVersion, state.language);

  const noCompatibility: string[] = [];
  for (const dep of state.dependencies) {
    if (dep.version === "unresolved" || dep.version === "range") continue;
    const key = `${dep.groupId}:${dep.artifactId}`;
    const constraints = compatDb.getConstraints(dep.groupId, dep.artifactId);
    const inC1 = c1Findings.some((f) => f.dependency === key);
    const inRemovals = compatDb.getRaw().some((e) =>
      e.constraints.some((c) =>
        (c.removed ?? []).some(
          (p) => dep.groupId.startsWith(p) || p.startsWith(dep.groupId),
        ),
      ),
    );
    if (constraints.length > 0 || inC1 || inRemovals) continue;
    const curatedMin = compatDb.getMinVersionForTarget(
      dep.groupId,
      dep.artifactId,
      state.language,
      targetVersion,
    );
    if (curatedMin !== null) continue;
    const inferred = parseChangelog(changelogMap[key], state.language, targetVersion);
    if (inferred.parseable) continue;
    noCompatibility.push(key);
  }

  const notChecked: NotChecked = {
    unresolved: state.dependencies.filter((d) => d.version === "unresolved").map(
      (d) => `${d.groupId}:${d.artifactId}`,
    ),
    range: state.dependencies.filter((d) => d.version === "range").map(
      (d) => `${d.groupId}:${d.artifactId}`,
    ),
    noRegistry: Object.entries(registryData)
      .filter(([, v]) => v.available === false)
      .map(([k]) => k),
    noCompatibility,
  };

  const unevaluated =
    notChecked.unresolved.length + notChecked.range.length + notChecked.noCompatibility.length;

  let verdict: Verdict;
  if (cycle) {
    verdict = "manual";
  } else if (blockingCount > 0) {
    verdict = "blocked";
  } else if (unevaluated > 0) {
    verdict = "partial";
  } else {
    verdict = "clear";
  }

  const steps = cycle ? ordered : withReviewSteps(ordered, notChecked, state.language, targetVersion);
  const summary = buildSummary(state, targetVersion, verdict, blockingCount, unevaluated, steps);

  return {
    schemaVersion: 1,
    verdict,
    summary,
    findings: allFindings,
    upgradeOrder: steps,
    blastRadius:
      allFindings.length > 0
        ? buildBlastRadius(allFindings, state.importMap)
        : Object.fromEntries(
            Object.entries(state.importMap).filter(([, files]) => files.length > 0),
          ),
    checkedAt: new Date().toISOString(),
    notChecked,
    c2Skipped,
    c2SkipReason,
  };
}
