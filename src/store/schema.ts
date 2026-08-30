// src/store/schema.ts
// Universal types for ctx state, cache, findings, and upgrade planning.
// These types are stack-agnostic: buildTool and language are open strings
// so the same schema supports any adapter without modification.
// Only src/adapters/ is stack-specific.

// ---------------------------------------------------------------------------
// state.json
// ---------------------------------------------------------------------------

export interface Dependency {
  groupId: string;
  artifactId: string;
  /** Resolved version string, or "unresolved" if a property could not be
   *  resolved, or "range" if the declared value is a version range. */
  version: string;
  scope: 'compile' | 'test' | 'provided' | 'runtime' | string;
  /** Original value before property resolution (e.g. "${postgresql.version}") */
  versionRaw: string;
}

export interface DatabasePlatformEntry {
  engine: string;
  version: string;
  declaredIn: string;
  service: string | null;
}

export interface DatabasePlatform {
  engine: 'postgres' | 'mysql' | 'mariadb' | 'mongo' | string | null;
  version: string | null;
  declaredIn: string | null;
  confidence: 'declared' | 'inferred';
  allFound: DatabasePlatformEntry[];
}

export interface PlatformInfo {
  database: DatabasePlatform;
}

export interface StateJson {
  schemaVersion: 1;
  scannedAt: string; // ISO 8601
  /** Primary language of the scanned project. Open string — filled by the adapter. */
  language: string;
  declaredRuntimeVersion: string | null;
  /** Build tool used. Open string — filled by the selected adapter. */
  buildTool: string;
  manifestPath: string;
  parentResolved: boolean;
  dependencies: Dependency[];
  platform: PlatformInfo;
  /** Maps a dependency groupId to the list of "file:line" import locations. */
  importMap: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// cache/<groupId>:<artifactId>.json
// ---------------------------------------------------------------------------

export interface CacheEntry {
  groupId: string;
  artifactId: string;
  latestVersion: string;
  versions: string[];
  fetchedAt: string; // ISO 8601
  stale: boolean;
  available: boolean;
  deprecated?: boolean | string;
  engines?: Record<string, string>;
  /** Raw changelog text captured at scan time, if any. */
  changelogText?: string;
}

// ---------------------------------------------------------------------------
// Findings and output schema
// ---------------------------------------------------------------------------

export type FindingClass =
  | 'C1_language_forces_dependency'
  | 'C2_dependency_drops_database'
  | 'C3_eol_advisory'
  | 'C4_technology_decision';

export type Severity = 'blocking' | 'warning';

export type EvidenceSource =
  | 'curated'
  | 'registry'
  | 'changelog-inferred'
  | 'unknown';

export interface FindingEvidence {
  fact: string;
  source: EvidenceSource;
  fetchedAt: string; // ISO 8601
}

export interface Finding {
  id: string;
  class: FindingClass;
  severity: Severity;
  dependency: string; // "groupId:artifactId"
  installed: string;
  minimumForTarget: string | null;
  dependsOn: string | null; // finding id
  evidence: FindingEvidence;
  /** Plain-English explanation — mandatory on every finding. */
  reason: string;
  /** false only for unevaluated deps — findings themselves are always known. */
  compatibilityKnown?: boolean;
}

export type StepKind = "code" | "infrastructure" | "config";

export interface UpgradeStep {
  step: number;
  action: string;
  kind: StepKind;
  resolves: string[]; // finding ids
  blockedBy: string[]; // "step N" references
}

export type Verdict = 'blocked' | 'clear' | 'manual' | 'partial';

export interface NotChecked {
  unresolved: string[];
  range: string[];
  noRegistry: string[];
  noCompatibility: string[];
}

export interface FindingsResult {
  schemaVersion: 1;
  verdict: Verdict;
  /** One-line, what the developer should do next. Always present. */
  summary: string;
  findings: Finding[];
  upgradeOrder: UpgradeStep[];
  /** Maps a dependency groupId to "file:line" import locations (blast radius). */
  blastRadius: Record<string, string[]>;
  checkedAt: string; // ISO 8601
  notChecked: NotChecked;
}

// ---------------------------------------------------------------------------
// case.json — recorded truth + logic baseline (capture → verify → handoff)
// ---------------------------------------------------------------------------

export type CaseInvariantKind = "edge" | "rule" | "contract";

export interface CaseDecision {
  id: string;
  fact: string;
  confirmedBy: string;
  at: string;
  /** If true, a modernization check is blocked: changing this risks system failure. */
  locked?: boolean;
}

export interface CaseInvariant {
  id: string;
  description: string;
  kind: CaseInvariantKind;
}

export interface CaseFileFingerprint {
  path: string;
  sha256: string;
}

export interface CaseDependencySnapshot {
  groupId: string;
  artifactId: string;
  version: string;
}

export interface CaseBaseline {
  declaredRuntimeVersion: string | null;
  language: string;
  buildTool: string;
  manifestPath: string;
  dependencies: CaseDependencySnapshot[];
  files: CaseFileFingerprint[];
  tests: CaseFileFingerprint[];
}

export type VerifyStatus = "same" | "changed" | "missing" | "untested";
export type VerifyKind = "runtime" | "dependency" | "file" | "test" | "invariant";
export type VerifyVerdict = "same" | "changed" | "untested";

export interface VerifyDiff {
  kind: VerifyKind;
  id: string;
  status: VerifyStatus;
  before?: string;
  after?: string;
  note?: string;
}

export interface VerifyReport {
  at: string;
  verdict: VerifyVerdict;
  summary: string;
  diffs: VerifyDiff[];
}

export interface CaseFile {
  schemaVersion: 1;
  capturedAt: string;
  capturedBy: string;
  language: string;
  declaredRuntimeVersion: string | null;
  buildTool: string;
  decisions: CaseDecision[];
  invariants: CaseInvariant[];
  baseline: CaseBaseline;
  lastVerify: VerifyReport | null;
}
