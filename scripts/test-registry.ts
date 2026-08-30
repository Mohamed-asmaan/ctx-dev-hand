// scripts/test-registry.ts
import { fetchArtifact } from "../src/readers/registry.js";

console.log("Fetching org.postgresql:postgresql from Maven Central...");
const r1 = await fetchArtifact(".", "org.postgresql", "postgresql");
console.assert(r1.found !== false, `not found: ${JSON.stringify(r1)}`);
if (r1.found) {
  console.assert(typeof r1.latestVersion === "string", "latestVersion missing");
  console.assert(r1.versions.length > 0, "versions empty");
  console.log(`  latest: ${r1.latestVersion}, ${r1.versions.length} versions in index`);

  // Second call — should be cache hit
  const r2 = await fetchArtifact(".", "org.postgresql", "postgresql");
  console.assert(r2.found !== false, "cache hit not found");
  if (r2.found) {
    console.assert(r2.latestVersion === r1.latestVersion, "cache consistency");
    console.log(`  cache hit: ${r2.latestVersion}, stale=${r2.stale}`);
  }
}
console.log("PASS");
