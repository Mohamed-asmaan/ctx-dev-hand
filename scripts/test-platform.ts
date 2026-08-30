// scripts/test-platform.ts
import { readPlatform } from "../src/readers/platform.js";

const p = await readPlatform("samples/legacy-java-app");
console.assert(p.database?.engine === "postgres", `engine: got ${p.database?.engine}`);
console.assert(p.database?.version === "9.6", `version: got ${p.database?.version}`);
console.assert(p.database?.declaredIn?.startsWith("docker-compose"), `declaredIn: got ${p.database?.declaredIn}`);
console.assert(p.database?.allFound.length === 1, `allFound length: ${p.database?.allFound.length}`);
console.log("PASS — platform:", JSON.stringify(p.database));
