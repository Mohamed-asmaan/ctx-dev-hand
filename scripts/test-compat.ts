// scripts/test-compat.ts
import { loadCompatibility } from "../src/compat/loader.js";

const db = loadCompatibility();

const c = db.getConstraints("org.postgresql", "postgresql");
console.assert(c.length > 0, `postgresql constraints: ${c.length}`);
console.log("  postgresql constraints:", c.length);

const r = db.getJdkRemovals("11");
console.assert(r.includes("javax.xml.bind"), `jaxb not in removals: ${JSON.stringify(r)}`);
console.assert(r.includes("javax.activation"), "javax.activation missing");
console.log("  jdk:removals for 11:", r);

// Should not return removals for lower versions
const r9 = db.getJdkRemovals("8");
console.assert(!r9.includes("javax.xml.bind"), "javax.xml.bind should not be listed for Java 8");
console.log("  jdk:removals for 8:", r9);

const minVer = db.getMinVersionForTarget("org.postgresql", "postgresql", "java", "11");
console.assert(minVer !== null, "minVersion for pg at java 11 should not be null");
console.log("  pg min version for java:11:", minVer);

console.log("PASS");
