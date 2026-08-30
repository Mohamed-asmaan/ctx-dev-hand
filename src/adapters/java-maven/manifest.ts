import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { CtxError } from "../../store/state.js";
import type { Dependency } from "../../store/schema.js";
import type { ManifestData } from "../types.js";

const RANGE_CHARS = /[\[\]\(\)]/;

function isRange(v: string): boolean {
  return RANGE_CHARS.test(v);
}

function isProperty(v: string): boolean {
  return v.startsWith("${") && v.endsWith("}");
}

function extractPropertyKey(v: string): string {
  return v.slice(2, -1);
}

export async function readManifest(repoRoot: string): Promise<ManifestData> {
  const pomPath = path.join(repoRoot, "pom.xml");

  let raw: string;
  try {
    raw = await fs.readFile(pomPath, "utf8");
  } catch {
    throw new CtxError("E1", `no Maven project found at ${repoRoot}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (tagName) =>
      tagName === "dependency" || tagName === "exclusion",
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      language: "java",
      declaredRuntimeVersion: null,
      buildTool: "maven",
      manifestPath: pomPath,
      parentResolved: false,
      dependencies: [],
    };
  }
  const project = (doc.project as Record<string, unknown>) ?? {};

  const props: Record<string, string> = {};
  const rawProps = project.properties;
  if (rawProps && typeof rawProps === "object") {
    for (const [k, v] of Object.entries(rawProps)) {
      if (typeof v === "string" || typeof v === "number") {
        props[k] = String(v);
      }
    }
  }

  function resolveValue(v: string | number | undefined): string {
    if (v === undefined || v === null) return "";
    const s = String(v);
    if (isProperty(s)) {
      const key = extractPropertyKey(s);
      return props[key] ?? s;
    }
    return s;
  }

  let declaredRuntimeVersion: string | null = null;
  const sourceVal = props["maven.compiler.source"];
  const targetVal = props["maven.compiler.target"];
  const javaVal = props["java.version"];

  if (sourceVal) {
    declaredRuntimeVersion = sourceVal;
  } else if (targetVal) {
    declaredRuntimeVersion = targetVal;
  } else if (javaVal) {
    declaredRuntimeVersion = javaVal;
  } else {
    const build = project.build as { plugins?: { plugin?: unknown[] } } | undefined;
    if (build) {
      const plugins = build.plugins?.plugin;
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
          const p = plugin as Record<string, unknown>;
          if (p.artifactId === "maven-compiler-plugin") {
            const config = p.configuration as Record<string, unknown> | undefined;
            if (config) {
              declaredRuntimeVersion =
                resolveValue(config.source as string | undefined) ||
                resolveValue(config.release as string | undefined) ||
                null;
            }
          }
        }
      }
    }
  }

  let parentResolved = true;
  if (project.parent) {
    parentResolved = false;
    process.stderr.write(
      `[ctx warn] pom.xml has a <parent> element — parent-managed versions are unresolved\n`,
    );
  }

  type DepBlock = { dependency?: unknown[] };
  type DepsBlock = { dependencies?: DepBlock };
  const depsList: unknown[] = [
    ...((project.dependencies as DepBlock | undefined)?.dependency ?? []),
    ...((project.dependencyManagement as DepsBlock | undefined)?.dependencies?.dependency ?? []),
  ];

  const dependencies: Dependency[] = [];

  for (const dep of depsList) {
    if (!dep || typeof dep !== "object") continue;
    const d = dep as Record<string, unknown>;

    const groupId = String(d.groupId ?? "").trim();
    const artifactId = String(d.artifactId ?? "").trim();
    const scope = String(d.scope ?? "compile").trim();
    const rawVersion = d.version !== undefined ? String(d.version) : "";

    if (!groupId || !artifactId) continue;

    let version: string;
    let versionRaw = rawVersion;

    if (!rawVersion) {
      version = "unresolved";
      versionRaw = "(managed)";
    } else if (isRange(rawVersion)) {
      version = "range";
    } else if (isProperty(rawVersion)) {
      const key = extractPropertyKey(rawVersion);
      const resolved = props[key];
      if (resolved) {
        version = resolved;
      } else {
        version = "unresolved";
        process.stderr.write(
          `[ctx warn] Cannot resolve version property ${rawVersion} for ${groupId}:${artifactId}\n`,
        );
      }
    } else {
      version = rawVersion;
    }

    dependencies.push({ groupId, artifactId, version, scope, versionRaw });
  }

  const boms = dependencies.filter(
    (d) => d.artifactId.endsWith("-bom") && d.version !== "unresolved" && d.version !== "range",
  );
  for (const dep of dependencies) {
    if (dep.version !== "unresolved") continue;
    const bom = boms.find(
      (b) => dep.groupId === b.groupId || dep.groupId.startsWith(`${b.groupId}.`),
    );
    if (!bom) continue;
    dep.version = bom.version;
    dep.versionRaw = `${dep.versionRaw} via ${bom.groupId}:${bom.artifactId}`;
  }

  return {
    language: "java",
    declaredRuntimeVersion,
    buildTool: "maven",
    manifestPath: "pom.xml",
    parentResolved,
    dependencies,
  };
}
