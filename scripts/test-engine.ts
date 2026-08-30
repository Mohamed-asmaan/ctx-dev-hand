// scripts/test-engine.ts
// Requires: ctx scan has already been run in samples/legacy-java-app

import { readState } from "../src/store/state.js";
import { loadCompatibility } from "../src/compat/loader.js";
import { runC1, runC2, runC3, resolveOrder, buildBlastRadius, runEngine } from "../src/compat/engine.js";
import { fetchArtifact } from "../src/readers/registry.js";

const state = await readState("samples/legacy-java-app");
const db = loadCompatibility();

// Build registry data map for C3
const registryData: Record<string, { latestVersion?: string; stale?: boolean; available?: boolean }> = {};
for (const dep of state.dependencies) {
  if (dep.version === "unresolved" || dep.version === "range") continue;
  const result = await fetchArtifact("samples/legacy-java-app", dep.groupId, dep.artifactId);
  if (result.found) {
    registryData[`${dep.groupId}:${dep.artifactId}`] = {
      latestVersion: result.latestVersion,
      stale: result.stale,
      available: true,
    };
  } else {
    registryData[`${dep.groupId}:${dep.artifactId}`] = { available: false };
  }
}

// --- C1 ---
const c1 = runC1(state, "11", db);
console.log(`C1 findings: ${c1.length}`);
for (const f of c1) {
  console.log(`  [${f.id}] ${f.dependency} → ${f.reason.slice(0, 80)}`);
}
console.assert(c1.length === 2, `C1: expected 2, got ${c1.length} — ${JSON.stringify(c1.map(f=>f.dependency))}`);

// --- C2 ---
const { findings: c2, skipped } = runC2(state, c1, db);
console.log(`C2 findings: ${c2.length}, skipped=${skipped}`);
for (const f of c2) {
  console.log(`  [${f.id}] ${f.dependency} → ${f.reason.slice(0, 80)}`);
}
console.assert(c2.length === 1, `C2: expected 1, got ${c2.length}`);
console.assert(c2[0].dependsOn !== null, "C2 finding should depend on a C1 finding");

// --- Order ---
const { steps, cycle } = resolveOrder([...c1, ...c2]);
console.log("Upgrade order:");
for (const s of steps) {
  console.log(`  Step ${s.step}: ${s.action} [resolves: ${s.resolves.join(",")}] [after: ${s.blockedBy.join(",")||"—"}]`);
}
console.assert(cycle === null, "no cycle expected");
console.assert(steps.length >= 3, `expected >=3 steps, got ${steps.length}`);
// C2 finding (database upgrade) must come before the driver upgrade
const dbStep = steps.find(s => s.action.toLowerCase().includes("postgres") || s.resolves.includes(c2[0].id));
const driverStep = steps.find(s => s.resolves.includes(c1[0].id));
if (dbStep && driverStep) {
  console.assert(dbStep.step < driverStep.step, `DB upgrade (step ${dbStep.step}) must be before driver upgrade (step ${driverStep.step})`);
}

// --- Blast radius ---
const blast = buildBlastRadius([...c1, ...c2], state.importMap);
console.log("Blast radius:", JSON.stringify(blast));

// --- Full engine run ---
const result = runEngine(state, "11", db, registryData);
console.assert(result.verdict === "blocked", `verdict: ${result.verdict}`);
console.assert(result.findings.filter(f => f.severity === "blocking").length >= 2, "at least 2 blocking findings");

console.log("\nFull result verdict:", result.verdict);
console.log("PASS");
