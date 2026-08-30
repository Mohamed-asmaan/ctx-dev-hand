import { readManifest } from "../src/readers/manifest.js";
const m = await readManifest("samples/legacy-java-app");
console.assert(m.declaredJavaVersion === "8", "java version");
console.assert(m.dependencies.length === 2, "2 deps");
console.assert(m.dependencies.some(d => d.artifactId === "postgresql"), "postgresql dep");
console.log("PASS");
