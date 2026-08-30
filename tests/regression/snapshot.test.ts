// tests/regression/snapshot.test.ts
// Regression harness: captures engine output for the reference scenario
// and asserts it doesn't change between runs.
// To update snapshots: npx vitest run tests/regression --reporter=verbose -u

import { describe, it, expect } from "vitest";
import path from "node:path";
import { readState } from "../../src/store/state.js";
import { loadCompatibility } from "../../src/compat/loader.js";
import { runEngine, type RegistryDataMap } from "../../src/compat/engine.js";

const SAMPLE_PROJECT = path.resolve("samples/legacy-java-app");

const MOCK_REGISTRY: RegistryDataMap = {
  "org.postgresql:postgresql": { latestVersion: "42.7.3", available: true, stale: false },
  "javax.xml.bind:jaxb-api": { latestVersion: "2.3.1", available: true, stale: false },
};

describe("regression — reference scenario snapshots", () => {
  it("finding count is stable", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), MOCK_REGISTRY);
    expect(result.findings.length).toMatchSnapshot();
  });

  it("verdict is stable", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), MOCK_REGISTRY);
    expect(result.verdict).toMatchSnapshot();
  });

  it("upgradeOrder step count is stable", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), MOCK_REGISTRY);
    expect(result.upgradeOrder.length).toMatchSnapshot();
  });

  it("finding classes are stable", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), MOCK_REGISTRY);
    const classes = result.findings.map((f) => f.class).sort();
    expect(classes).toMatchSnapshot();
  });

  it("blast radius keys are stable", async () => {
    const state = await readState(SAMPLE_PROJECT);
    const result = runEngine(state, "11", loadCompatibility(), MOCK_REGISTRY);
    const keys = Object.keys(result.blastRadius).sort();
    expect(keys).toMatchSnapshot();
  });
});
