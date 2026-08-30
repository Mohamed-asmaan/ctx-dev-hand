import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Dependency } from "../../store/schema.js";
import type { ImportLocation } from "../types.js";

const FILE_CAP = 5000;

const FROM_IMPORT = /(?:^|\s)import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/;
const SIDE_EFFECT_IMPORT = /^import\s+['"]([^'"]+)['"]/;
const REQUIRE_CALL = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function bareName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0] ?? null;
}

export async function scanImports(
  repoRoot: string,
  dependencies: Dependency[],
): Promise<ImportLocation[]> {
  const known = new Set(dependencies.map((d) => d.artifactId));

  let files = await fg("**/*.{js,jsx,ts,tsx}", {
    cwd: repoRoot,
    ignore: ["node_modules/**", "dist/**", "build/**", ".ctx/**"],
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

  function record(pkg: string, location: string) {
    if (!known.has(pkg)) return;
    const key = `${pkg}|${location}`;
    if (seen.has(key)) return;
    seen.add(key);
    locations.push({ packageId: pkg, location });
  }

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
      const loc = `${repoRelative}:${i + 1}`;

      const side = SIDE_EFFECT_IMPORT.exec(line);
      const from = FROM_IMPORT.exec(line);
      const spec = side?.[1] ?? from?.[1];
      if (spec) {
        const name = bareName(spec);
        if (name) record(name, loc);
      }

      REQUIRE_CALL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REQUIRE_CALL.exec(line)) !== null) {
        const name = bareName(m[1]);
        if (name) record(name, loc);
      }
    }
  }

  return locations;
}
