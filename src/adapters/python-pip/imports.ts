import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Dependency } from "../../store/schema.js";
import type { ImportLocation } from "../types.js";

const FILE_CAP = 5000;
const IMPORT_RE = /^(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)/;

export async function scanImports(
  repoRoot: string,
  dependencies: Dependency[],
): Promise<ImportLocation[]> {
  const known = new Set(dependencies.map((d) => d.artifactId.replace(/-/g, "_")));
  const nameByMod = new Map<string, string>();
  for (const d of dependencies) {
    nameByMod.set(d.artifactId.replace(/-/g, "_"), d.artifactId);
    nameByMod.set(d.artifactId, d.artifactId);
  }

  let files = await fg("**/*.py", {
    cwd: repoRoot,
    ignore: [".venv/**", "venv/**", "env/**", "__pycache__/**", "dist/**", "build/**", ".ctx/**"],
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
      const line = lines[i].trim();
      if (line.startsWith("#")) continue;
      const m = IMPORT_RE.exec(line);
      if (!m) continue;
      const mod = m[1];
      const pkg = nameByMod.get(mod);
      if (!pkg || !known.has(mod)) continue;
      const location = `${repoRelative}:${i + 1}`;
      const key = `${pkg}|${location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({ packageId: pkg, location });
    }
  }

  return locations;
}
