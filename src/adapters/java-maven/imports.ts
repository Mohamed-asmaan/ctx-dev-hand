import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Dependency } from "../../store/schema.js";

const FILE_CAP = 5000;

const GROUP_PREFIXES: Record<string, string> = {
  "org.postgresql": "org.postgresql",
  "javax.xml.bind": "javax.xml.bind",
  "javax.activation": "javax.activation",
  "java.xml.ws": "java.xml.ws",
  "javax.annotation": "javax.annotation",
  "java.corba": "java.corba",
  "com.mysql": "mysql",
  "org.springframework": "org.springframework",
  "org.hibernate": "org.hibernate",
  "org.apache.commons": "commons-lang3",
  "com.fasterxml.jackson": "com.fasterxml.jackson.core",
  "org.slf4j": "org.slf4j",
  "ch.qos.logback": "ch.qos.logback",
  "org.apache.http": "org.apache.httpcomponents",
  "com.google.guava": "com.google.guava",
  "com.google.common": "com.google.guava",
  "com.google.gson": "com.google.code.gson",
  "com.google.code.gson": "com.google.code.gson",
  "org.junit.jupiter": "org.junit.jupiter",
  "org.junit": "org.junit",
};

const IMPORT_REGEX = /^import\s+(static\s+)?([a-zA-Z0-9_.]+(?:\.\*)?);/;

export interface ScanImportsResult {
  importMap: Record<string, string[]>;
  capped: boolean;
}

export async function scanImports(
  repoRoot: string,
  dependencies: Dependency[],
): Promise<ScanImportsResult> {
  const knownGroupIds = new Set(dependencies.map((d) => d.groupId));

  let javaFiles = await fg("**/*.java", {
    cwd: repoRoot,
    ignore: ["target/**", "build/**", ".ctx/**"],
    absolute: true,
    onlyFiles: true,
  });

  let capped = false;
  if (javaFiles.length > FILE_CAP) {
    javaFiles = javaFiles.slice(0, FILE_CAP);
    capped = true;
    process.stderr.write(
      `[ctx warn] Import scan capped at ${FILE_CAP} files (repo has more)\n`,
    );
  }

  const importMap: Record<string, string[]> = {};
  for (const dep of dependencies) {
    importMap[dep.groupId] = importMap[dep.groupId] ?? [];
  }

  for (const absFile of javaFiles) {
    const repoRelative = path.relative(repoRoot, absFile).replace(/\\/g, "/");
    let content: string;
    try {
      content = await fs.readFile(absFile, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = IMPORT_REGEX.exec(line);
      if (!match) continue;

      const fullImport = match[2];

      let matchedGroupId: string | null = null;
      for (const [prefix, groupId] of Object.entries(GROUP_PREFIXES)) {
        if (fullImport.startsWith(prefix + ".") || fullImport === prefix) {
          matchedGroupId = groupId;
          break;
        }
      }

      if (!matchedGroupId) continue;
      if (!knownGroupIds.has(matchedGroupId)) continue;

      const entry = `${repoRelative}:${i + 1}`;
      if (!importMap[matchedGroupId]) {
        importMap[matchedGroupId] = [];
      }
      if (!importMap[matchedGroupId].includes(entry)) {
        importMap[matchedGroupId].push(entry);
      }
    }
  }

  return { importMap, capped };
}
