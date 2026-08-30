// src/readers/platform.ts
// Detects the declared database version from project configuration files.
// Precedence: .ctx/config.json > docker-compose.yml > Dockerfile.
// Never guesses — if nothing is found, returns { database: null }.

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { PlatformInfo, DatabasePlatform, DatabasePlatformEntry } from "../store/schema.js";

const DB_KEYWORDS = ["postgres", "mysql", "mariadb", "mongo"] as const;

function detectEngine(image: string): string | null {
  const lower = image.toLowerCase();
  for (const kw of DB_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function extractVersion(image: string): string {
  const colon = image.lastIndexOf(":");
  if (colon === -1) return "latest";
  const tag = image.slice(colon + 1).split("-")[0]; // strip e.g. "-alpine"
  return tag || "latest";
}

function lineNumber(raw: string, image: string): number {
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(image)) return i + 1;
  }
  return 0;
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readFromCtxConfig(repoRoot: string): Promise<DatabasePlatform | null> {
  const configPath = path.join(repoRoot, ".ctx", "config.json");
  const raw = await tryReadFile(configPath);
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as { platform?: { database?: DatabasePlatform } };
    if (config?.platform?.database) {
      return config.platform.database;
    }
  } catch {
    /* ignore malformed config */
  }
  return null;
}

async function readFromDockerCompose(repoRoot: string): Promise<DatabasePlatform | null> {
  // E19: prefer docker-compose.yml over docker-compose.yaml
  const ymlPath = path.join(repoRoot, "docker-compose.yml");
  const yamlPath = path.join(repoRoot, "docker-compose.yaml");

  let composeFile: string | null = null;
  let usedFileName = "";

  const ymlRaw = await tryReadFile(ymlPath);
  if (ymlRaw !== null) {
    composeFile = ymlRaw;
    usedFileName = "docker-compose.yml";

    // E19: warn if both exist
    const yamlRaw = await tryReadFile(yamlPath);
    if (yamlRaw !== null) {
      process.stderr.write(
        "[ctx warn] Both docker-compose.yml and docker-compose.yaml found — using docker-compose.yml\n",
      );
    }
  } else {
    const yamlRaw = await tryReadFile(yamlPath);
    if (yamlRaw !== null) {
      composeFile = yamlRaw;
      usedFileName = "docker-compose.yaml";
    }
  }

  if (!composeFile) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(composeFile);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const compose = parsed as Record<string, unknown>;
  const services = compose.services as Record<string, unknown> | undefined;
  if (!services) return null;

  const found: DatabasePlatformEntry[] = [];

  for (const [serviceName, serviceDef] of Object.entries(services)) {
    if (!serviceDef || typeof serviceDef !== "object") continue;
    const service = serviceDef as Record<string, unknown>;
    const image = service.image as string | undefined;
    if (!image) continue;

    const engine = detectEngine(image);
    if (!engine) continue;

    const version = extractVersion(image);
    const line = lineNumber(composeFile, image);
    found.push({
      engine,
      version,
      declaredIn: `${usedFileName}:${line}`,
      service: serviceName,
    });
  }

  if (found.length === 0) return null;

  // Primary entry is the first found; allFound covers E6
  const primary = found[0];
  return {
    engine: primary.engine,
    version: primary.version,
    declaredIn: primary.declaredIn,
    confidence: "declared",
    allFound: found,
  };
}

async function readFromDockerfile(repoRoot: string): Promise<DatabasePlatform | null> {
  const dockerfilePath = path.join(repoRoot, "Dockerfile");
  const raw = await tryReadFile(dockerfilePath);
  if (!raw) return null;

  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.toUpperCase().startsWith("FROM ")) continue;
    // FROM postgres:9.6  or  FROM postgres:9.6-alpine
    const image = line.slice(5).split(/\s/)[0];
    const engine = detectEngine(image);
    if (!engine) continue;
    const version = extractVersion(image);
    const entry: DatabasePlatformEntry = {
      engine,
      version,
      declaredIn: `Dockerfile:${i + 1}`,
      service: null,
    };
    return {
      engine,
      version,
      declaredIn: `Dockerfile:${i + 1}`,
      confidence: "declared",
      allFound: [entry],
    };
  }
  return null;
}

export async function readPlatform(repoRoot: string): Promise<PlatformInfo> {
  // Precedence: .ctx/config.json > docker-compose > Dockerfile
  const fromConfig = await readFromCtxConfig(repoRoot);
  if (fromConfig) return { database: fromConfig };

  const fromCompose = await readFromDockerCompose(repoRoot);
  if (fromCompose) return { database: fromCompose };

  const fromDockerfile = await readFromDockerfile(repoRoot);
  if (fromDockerfile) return { database: fromDockerfile };

  // E5: nothing found
  return {
    database: {
      engine: null,
      version: null,
      declaredIn: null,
      confidence: "declared",
      allFound: [],
    },
  };
}
