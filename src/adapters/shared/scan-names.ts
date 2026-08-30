import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Dependency } from "../../store/schema.js";
import type { ImportLocation } from "../types.js";

const FILE_CAP = 5000;

export async function scanDepNames(
  repoRoot: string,
  globs: string[],
  dependencies: Dependency[],
  ignore: string[] = ["node_modules/**", "vendor/**", "target/**", "dist/**", "build/**", ".ctx/**"],
): Promise<ImportLocation[]> {
  const needles = dependencies
    .map((d) => ({
      packageId: d.groupId,
      tokens: [d.groupId, d.artifactId].filter((t) => t && t.length > 1),
    }))
    .filter((n) => n.tokens.length > 0);

  if (needles.length === 0) return [];

  let files = await fg(globs, {
    cwd: repoRoot,
    ignore,
    absolute: true,
    onlyFiles: true,
  });

  if (files.length > FILE_CAP) {
    files = files.slice(0, FILE_CAP);
    process.stderr.write(
      `[ctx warn] Import scan capped at ${FILE_CAP} files (repo has more)\n`,
    );
  }

  const seen = new Set<string>();
  const locations: ImportLocation[] = [];

  for (const absFile of files) {
    const repoRelative = path.relative(repoRoot, absFile).replace(/\\/g, "/");
    let content: string;
    try {
      content = await fs.readFile(absFile, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const needle of needles) {
        if (!needle.tokens.some((t) => line.includes(t))) continue;
        const loc = `${repoRelative}:${i + 1}`;
        const key = `${needle.packageId}|${loc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push({ packageId: needle.packageId, location: loc });
      }
    }
  }

  return locations;
}
