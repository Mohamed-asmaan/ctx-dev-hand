// scripts/test-imports.ts
import { readManifest } from "../src/readers/manifest.js";
import { scanImports } from "../src/readers/imports.js";

const m = await readManifest("samples/legacy-java-app");
const result = await scanImports("samples/legacy-java-app", m.dependencies);

const pgFiles = result.importMap["org.postgresql"] ?? [];
const jaxbFiles = result.importMap["javax.xml.bind"] ?? [];

console.assert(pgFiles.some(l => l.includes("Connection.java")), `Connection.java missing: ${JSON.stringify(pgFiles)}`);
console.assert(pgFiles.some(l => l.includes("Pool.java")), `Pool.java missing: ${JSON.stringify(pgFiles)}`);
console.assert(jaxbFiles.some(l => l.includes("XmlMapper.java")), `XmlMapper.java missing: ${JSON.stringify(jaxbFiles)}`);
console.assert(!result.capped, "should not be capped for tiny sample");
console.log("PASS — imports:", JSON.stringify({ pg: pgFiles, jaxb: jaxbFiles }));
