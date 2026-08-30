// src/store/config.ts
// Read/write helpers for .ctx/config.json — the per-repo opt-in marker.
// Absence or enabled:false means ctx is off for that repo.

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

export const CTX_DIR = ".ctx";
export const CONFIG_FILE = "config.json";

export interface CtxConfig {
  schemaVersion: 1;
  enabled: boolean;
}

export function configPath(repoRoot: string): string {
  return path.join(repoRoot, CTX_DIR, CONFIG_FILE);
}

export function isCtxEnabledSync(repoRoot: string): boolean {
  try {
    const raw = fs.readFileSync(configPath(repoRoot), "utf8");
    const parsed = JSON.parse(raw) as CtxConfig;
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

export async function readConfig(repoRoot: string): Promise<CtxConfig | null> {
  try {
    const raw = await fsPromises.readFile(configPath(repoRoot), "utf8");
    return JSON.parse(raw) as CtxConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(repoRoot: string, config: CtxConfig): Promise<void> {
  const dir = path.join(repoRoot, CTX_DIR);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(configPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function isCtxEnabled(repoRoot: string): Promise<boolean> {
  const config = await readConfig(repoRoot);
  return config?.enabled === true;
}
