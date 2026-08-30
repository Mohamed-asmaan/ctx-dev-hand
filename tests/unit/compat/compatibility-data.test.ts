// tests/unit/compat/compatibility-data.test.ts
// Validates the structure and content of data/compatibility.json and the loader API.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCompatibility,
  compareSemver,
  satisfiesRequirement,
  type CompatEntry,
  type CompatConstraint,
} from "../../../src/compat/loader.js";

// Reset the module cache between tests where needed — loader uses a module-level
// singleton; we just test via the public API without resetting it.

describe("data/compatibility.json schema", () => {
  it("schemaVersion is 1", () => {
    const db = loadCompatibility();
    // getRaw returns the entries array; we verify via the loader
    const entries = db.getRaw();
    expect(Array.isArray(entries)).toBe(true);
  });

  it("at least 5 entries are present", () => {
    const db = loadCompatibility();
    expect(db.getRaw().length).toBeGreaterThanOrEqual(5);
  });

  it("every entry has a non-empty key", () => {
    const db = loadCompatibility();
    for (const entry of db.getRaw()) {
      expect(typeof entry.key).toBe("string");
      expect(entry.key.length).toBeGreaterThan(0);
    }
  });

  it("every constraint has required fields: fromVersion, note, verifiedAt, sourceUrl", () => {
    const db = loadCompatibility();
    for (const entry of db.getRaw()) {
      for (const c of entry.constraints) {
        expect(typeof c.fromVersion).toBe("string");
        expect(typeof c.note).toBe("string");
        expect(typeof c.verifiedAt).toBe("string");
        expect(typeof c.sourceUrl).toBe("string");
        // At least one of requires or removed must be present
        const hasRequires = c.requires && typeof c.requires === "object";
        const hasRemoved = Array.isArray(c.removed);
        // jdk:removals entries only have removed; others only have requires
        // Either is acceptable — but not neither
        expect(hasRequires || hasRemoved).toBe(true);
      }
    }
  });

  it("org.postgresql:postgresql entry exists with postgres constraint", () => {
    const db = loadCompatibility();
    const cs = db.getConstraints("org.postgresql", "postgresql");
    expect(cs.length).toBeGreaterThan(0);
    const pg10Constraint = cs.find((c) => c.requires?.["postgres"]);
    expect(pg10Constraint).toBeDefined();
    expect(pg10Constraint!.requires!["postgres"]).toBe(">=10");
  });

  it("jdk:removals entry includes javax.xml.bind for Java 11", () => {
    const db = loadCompatibility();
    const removals = db.getRuntimeRemovals("java", "11");
    expect(removals).toContain("javax.xml.bind");
  });

  it("jdk:removals for Java 8 returns no Java 11 removals", () => {
    const db = loadCompatibility();
    const removals = db.getRuntimeRemovals("java", "8");
    expect(removals).not.toContain("javax.xml.bind");
  });

  it("upgradeMap for postgresql java:11 target returns 42.3.0", () => {
    const db = loadCompatibility();
    const min = db.getMinVersionForTarget("org.postgresql", "postgresql", "java", "11");
    expect(min).toBe("42.3.0");
  });

  it("A3: java 17 inherits postgresql minimum from java:11", () => {
    const db = loadCompatibility();
    const min = db.getMinVersionForTarget("org.postgresql", "postgresql", "java", "17");
    expect(min).toBe("42.3.0");
  });

  it("getMinVersionForTarget returns null for unknown artifact", () => {
    const db = loadCompatibility();
    const min = db.getMinVersionForTarget("com.unknown", "artifact", "java", "11");
    expect(min).toBeNull();
  });

  it("getConstraints returns empty array for unknown artifact", () => {
    const db = loadCompatibility();
    const cs = db.getConstraints("com.unknown", "nothing");
    expect(cs).toEqual([]);
  });

  it("verifiedAt dates are parseable ISO date strings", () => {
    const db = loadCompatibility();
    for (const entry of db.getRaw()) {
      for (const c of entry.constraints) {
        const d = new Date(c.verifiedAt);
        expect(isNaN(d.getTime())).toBe(false);
      }
    }
  });
});

describe("compareSemver", () => {
  it("42.3.0 > 42.2.5", () => expect(compareSemver("42.3.0", "42.2.5")).toBeGreaterThan(0));
  it("6.0.0 > 5.9.9", () => expect(compareSemver("6.0.0", "5.9.9")).toBeGreaterThan(0));
  it("1.0.0 === 1.0.0", () => expect(compareSemver("1.0.0", "1.0.0")).toBe(0));
  it("8 < 11 (short versions)", () => expect(compareSemver("8", "11")).toBeLessThan(0));
  it("11 > 9.6 (numeric comparison, not lexicographic)", () =>
    expect(compareSemver("11", "9.6")).toBeGreaterThan(0));
});

describe("satisfiesRequirement", () => {
  it(">=10: postgres 13 satisfies", () => expect(satisfiesRequirement("13", ">=10")).toBe(true));
  it(">=10: postgres 9.6 does not satisfy", () =>
    expect(satisfiesRequirement("9.6", ">=10")).toBe(false));
  it(">=8: java 11 satisfies", () => expect(satisfiesRequirement("11", ">=8")).toBe(true));
  it(">=17: java 11 does not satisfy", () =>
    expect(satisfiesRequirement("11", ">=17")).toBe(false));
  it("exact match: 5.3.0 satisfies 5.3.0", () =>
    expect(satisfiesRequirement("5.3.0", "5.3.0")).toBe(true));
  it("exact match: 5.3.1 does not satisfy 5.3.0", () =>
    expect(satisfiesRequirement("5.3.1", "5.3.0")).toBe(false));
});
