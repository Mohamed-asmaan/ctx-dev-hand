import type {
  CaseDecision,
  CaseFile,
  CaseFileFingerprint,
  CaseInvariant,
  CaseInvariantKind,
  StateJson,
} from "../store/schema.js";
import { hashFile } from "../store/case.js";
import { absInRepo, collectTrackedPaths, findTestFiles } from "./paths.js";

export interface CaptureInput {
  decisions?: string[];
  edges?: string[];
  rules?: string[];
  contracts?: string[];
  /** Locked facts. A later modernize/check is blocked until a person unlocks them. */
  locks?: string[];
  by?: string;
  replace?: boolean;
  now?: string;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function fingerprint(
  repoRoot: string,
  relPaths: string[],
): Promise<CaseFileFingerprint[]> {
  const out: CaseFileFingerprint[] = [];
  for (const rel of relPaths) {
    const sha256 = await hashFile(absInRepo(repoRoot, rel));
    if (!sha256) continue;
    out.push({ path: rel, sha256 });
  }
  return out;
}

export function scanDecisions(state: StateJson, at: string): CaseDecision[] {
  const decisions: CaseDecision[] = [
    {
      id: "scan:runtime",
      fact: `${state.language} is version ${state.declaredRuntimeVersion ?? "(not found in the build file)"}`,
      confirmedBy: "scan",
      at,
    },
    {
      id: "scan:build",
      fact: `Build tool is ${state.buildTool}`,
      confirmedBy: "scan",
      at,
    },
  ];
  for (const dep of state.dependencies) {
    decisions.push({
      id: `scan:dep:${dep.groupId}:${dep.artifactId}`,
      fact: `${dep.groupId}:${dep.artifactId} is ${dep.version === "unresolved" ? "version not listed" : dep.version}`,
      confirmedBy: "scan",
      at,
    });
  }
  const db = state.platform?.database;
  if (db?.engine) {
    decisions.push({
      id: "scan:database",
      fact: `Database is ${db.engine} ${db.version ?? "(version not listed)"}`,
      confirmedBy: "scan",
      at,
    });
  }
  return decisions;
}

function humanFacts(
  items: string[] | undefined,
  kind: CaseInvariantKind,
): CaseInvariant[] {
  return (items ?? []).map((description, i) => ({
    id: `human:${kind}:${slug(description) || i}`,
    description,
    kind,
  }));
}

function mergeDecisions(
  previous: CaseFile | null,
  scanned: CaseDecision[],
  extraFacts: string[],
  lockFacts: string[],
  by: string,
  at: string,
  replace: boolean,
): CaseDecision[] {
  const kept =
    !replace && previous
      ? previous.decisions.filter((d) => d.confirmedBy !== "scan")
      : [];
  const extras: CaseDecision[] = extraFacts.map((fact, i) => ({
    id: `human:decision:${slug(fact) || i}`,
    fact,
    confirmedBy: by,
    at,
  }));
  const locks: CaseDecision[] = lockFacts.map((fact, i) => ({
    id: `human:lock:${slug(fact) || i}`,
    fact,
    confirmedBy: by,
    at,
    locked: true,
  }));
  const seen = new Set<string>();
  const out: CaseDecision[] = [];
  for (const d of [...scanned, ...kept, ...extras, ...locks]) {
    const existing = out.find((x) => x.id === d.id || x.fact === d.fact);
    if (existing) {
      if (d.locked) existing.locked = true;
      continue;
    }
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

function mergeInvariants(
  previous: CaseFile | null,
  added: CaseInvariant[],
  replace: boolean,
): CaseInvariant[] {
  const kept = !replace && previous ? previous.invariants : [];
  const seen = new Set<string>();
  const out: CaseInvariant[] = [];
  for (const inv of [...kept, ...added]) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    out.push(inv);
  }
  return out;
}

export async function buildCaseFile(
  repoRoot: string,
  state: StateJson,
  previous: CaseFile | null,
  input: CaptureInput = {},
): Promise<CaseFile> {
  const at = input.now ?? new Date().toISOString();
  const by = input.by ?? "human";
  const replace = input.replace === true;

  const tracked = collectTrackedPaths(state);
  const testPaths = await findTestFiles(repoRoot);
  const files = await fingerprint(repoRoot, tracked);
  const tests = await fingerprint(repoRoot, testPaths);

  const addedInvariants = [
    ...humanFacts(input.edges, "edge"),
    ...humanFacts(input.rules, "rule"),
    ...humanFacts(input.contracts, "contract"),
  ];

  return {
    schemaVersion: 1,
    capturedAt: at,
    capturedBy: `ctx capture (${by})`,
    language: state.language,
    declaredRuntimeVersion: state.declaredRuntimeVersion,
    buildTool: state.buildTool,
    decisions: mergeDecisions(
      previous,
      scanDecisions(state, at),
      input.decisions ?? [],
      input.locks ?? [],
      by,
      at,
      replace,
    ),
    invariants: mergeInvariants(previous, addedInvariants, replace),
    baseline: {
      declaredRuntimeVersion: state.declaredRuntimeVersion,
      language: state.language,
      buildTool: state.buildTool,
      manifestPath: state.manifestPath,
      dependencies: state.dependencies.map((d) => ({
        groupId: d.groupId,
        artifactId: d.artifactId,
        version: d.version,
      })),
      files,
      tests,
    },
    lastVerify: null,
  };
}
