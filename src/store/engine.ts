import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CtxError } from "./state.js";
import { isCtxEnabled } from "./config.js";
import { ENGINE_OFF, NOT_ENABLED, notConnected } from "../messages.js";

export interface EngineState {
  schemaVersion: 1;
  running: boolean;
  connected: string[];
}

function packageRoot(): string {
  return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

export function engineFilePath(): string {
  if (process.env.CTX_ENGINE_FILE) return process.env.CTX_ENGINE_FILE;
  return path.join(packageRoot(), ".ctx", "engine.json");
}

export function normalizeRepoPath(p: string): string {
  let abs = path.resolve(p).replace(/\\/g, "/");
  if (abs.length > 1 && abs.endsWith("/")) abs = abs.slice(0, -1);
  if (process.platform === "win32") abs = abs.toLowerCase();
  return abs;
}

export function emptyEngine(): EngineState {
  return { schemaVersion: 1, running: false, connected: [] };
}

export async function readEngine(): Promise<EngineState> {
  try {
    const raw = await fs.readFile(engineFilePath(), "utf8");
    const parsed = JSON.parse(raw) as EngineState;
    if (parsed.schemaVersion !== 1 || typeof parsed.running !== "boolean") {
      return emptyEngine();
    }
    return {
      schemaVersion: 1,
      running: parsed.running === true,
      connected: Array.isArray(parsed.connected)
        ? parsed.connected.map((c) => normalizeRepoPath(String(c)))
        : [],
    };
  } catch {
    return emptyEngine();
  }
}

export async function writeEngine(state: EngineState): Promise<void> {
  const file = engineFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function isConnected(engine: EngineState, repoRoot: string): boolean {
  return engine.connected.includes(normalizeRepoPath(repoRoot));
}

export async function assertEngineRunning(): Promise<EngineState> {
  const engine = await readEngine();
  if (!engine.running) throw new CtxError("E24", ENGINE_OFF);
  return engine;
}

export async function assertConnected(repoRoot: string): Promise<EngineState> {
  const engine = await assertEngineRunning();
  if (!isConnected(engine, repoRoot)) {
    throw new CtxError("E25", notConnected(repoRoot));
  }
  return engine;
}

export async function assertLiveWork(repoRoot: string): Promise<string> {
  const abs = path.resolve(repoRoot);
  await assertConnected(abs);
  if (!(await isCtxEnabled(abs))) {
    throw new CtxError("E22", NOT_ENABLED);
  }
  return abs;
}
