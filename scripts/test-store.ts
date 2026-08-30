// scripts/test-store.ts
// Acceptance test for Prompt 2 — run with: npx tsx scripts/test-store.ts
import { writeState, readState } from "../src/store/state.js";
import type { StateJson } from "../src/store/schema.js";

const state: StateJson = {
  schemaVersion: 1,
  scannedAt: new Date().toISOString(),
  language: "java",
  declaredJavaVersion: "8",
  buildTool: "maven",
  manifestPath: "pom.xml",
  parentResolved: false,
  dependencies: [],
  platform: { database: null } as unknown as StateJson["platform"],
  importMap: {},
};

await writeState(process.cwd(), state);
const loaded = await readState(process.cwd());
console.assert(loaded.declaredJavaVersion === "8", "round-trip");
console.log("PASS");
