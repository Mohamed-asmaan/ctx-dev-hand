import fs from "node:fs/promises";
import path from "node:path";
import { CtxError } from "../../store/state.js";
import type { Dependency } from "../../store/schema.js";
import type { ManifestData } from "../types.js";

function isRange(v: string): boolean {
  if (/[\[\]\(\)*]/.test(v)) return true;
  if (v.includes(",")) return true;
  if (v.startsWith(">") || v.startsWith("<") || v.startsWith("~") || v.startsWith("^")) return true;
  return false;
}

function parseReqLine(line: string): { name: string; version: string; raw: string } | null {
  const trimmed = line.replace(/#.*$/, "").trim();
  if (!trimmed || trimmed.startsWith("-")) return null;
  const m = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:\[.*?\])?\s*(?:==|===)?\s*([^;]+)?/);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/_/g, "-");
  const version = (m[2] ?? "").trim().split(/\s+/)[0] ?? "";
  return { name, version, raw: trimmed };
}

async function readFirst(repoRoot: string, names: string[]): Promise<{ file: string; text: string } | null> {
  for (const file of names) {
    try {
      const text = await fs.readFile(path.join(repoRoot, file), "utf8");
      return { file, text };
    } catch {
      /* next */
    }
  }
  return null;
}

async function declaredRuntime(repoRoot: string, pyproject: string | null): Promise<string | null> {
  const runtime = await readFirst(repoRoot, [".python-version", "runtime.txt"]);
  if (runtime) {
    const m = runtime.text.trim().match(/(\d+(?:\.\d+)*)/);
    if (m) return m[1];
  }
  if (pyproject) {
    const m = pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/i);
    if (m) {
      const ver = m[1].match(/(\d+(?:\.\d+)*)/);
      if (ver) return ver[1];
    }
  }
  return null;
}

export async function readManifest(repoRoot: string): Promise<ManifestData> {
  const req = await readFirst(repoRoot, ["requirements.txt", "requirements-dev.txt"]);
  let pyproject: string | null = null;
  try {
    pyproject = await fs.readFile(path.join(repoRoot, "pyproject.toml"), "utf8");
  } catch {
    pyproject = null;
  }

  if (!req && !pyproject) {
    throw new CtxError("E1", `no Python project found at ${repoRoot}`);
  }

  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  function add(name: string, versionRaw: string, scope: string) {
    const artifactId = name.toLowerCase();
    if (seen.has(artifactId)) return;
    seen.add(artifactId);
    let version = versionRaw.replace(/^[=<>!~]+/, "").trim();
    if (!version) version = "unresolved";
    else if (isRange(versionRaw) && !versionRaw.includes("==")) version = "range";
    dependencies.push({
      groupId: artifactId,
      artifactId,
      version,
      scope,
      versionRaw,
    });
  }

  if (req) {
    for (const line of req.text.split(/\r?\n/)) {
      const parsed = parseReqLine(line);
      if (parsed) add(parsed.name, parsed.version || parsed.raw, "runtime");
    }
  }

  if (pyproject) {
    const depBlock = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depBlock) {
      for (const item of depBlock[1].matchAll(/["']([^"']+)["']/g)) {
        const parsed = parseReqLine(item[1]);
        if (parsed) add(parsed.name, parsed.version || parsed.raw, "runtime");
      }
    }
  }

  return {
    language: "python",
    declaredRuntimeVersion: await declaredRuntime(repoRoot, pyproject),
    buildTool: "pip",
    manifestPath: req?.file ?? "pyproject.toml",
    parentResolved: true,
    dependencies,
  };
}
