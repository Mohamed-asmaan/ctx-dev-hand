import fs from "node:fs/promises";
import path from "node:path";
import { CtxError } from "../store/state.js";
import {
  type EngineState,
  assertEngineRunning,
  isConnected,
  normalizeRepoPath,
  readEngine,
  writeEngine,
} from "../store/engine.js";
import { PATH_MISSING } from "../messages.js";
import { ctxPackageRoot } from "./environment.js";
import type { StatusItem } from "./environment.js";

function print(lines: string[]): void {
  process.stdout.write(`${lines.join("\n")}\n`);
}

function listConnected(engine: EngineState): string {
  return engine.connected.length === 0 ? "(none)" : engine.connected.join("; ");
}

export async function runEngineStart(): Promise<EngineState> {
  const prev = await readEngine();
  const next: EngineState = { ...prev, running: true };
  await writeEngine(next);
  print([
    "",
    "ctx engine — started",
    "─".repeat(57),
    `  engine : ${ctxPackageRoot()}`,
    `  linked : ${listConnected(next)}`,
    "─".repeat(57),
    "  Next: node dist/cli.js connect \"<path-to-app>\"",
    "",
  ]);
  return next;
}

export async function runEngineStop(): Promise<EngineState> {
  const prev = await readEngine();
  const next: EngineState = { ...prev, running: false };
  await writeEngine(next);
  print([
    "",
    "ctx engine — stopped",
    "─".repeat(57),
    "  status : off. scan / check / on / MCP will not run.",
    `  linked : ${listConnected(next)} (kept)`,
    "─".repeat(57),
    "",
  ]);
  return next;
}

export async function runEngineStatus(): Promise<EngineState> {
  const engine = await readEngine();
  print([
    "",
    "ctx engine — status",
    "─".repeat(57),
    `  engine : ${ctxPackageRoot()}`,
    `  status : ${engine.running ? "running" : "off"}`,
    `  linked : ${listConnected(engine)}`,
    "─".repeat(57),
    "",
  ]);
  return engine;
}

export async function runConnect(repoRoot: string): Promise<EngineState> {
  await assertEngineRunning();
  const abs = path.resolve(repoRoot);
  try {
    const st = await fs.stat(abs);
    if (!st.isDirectory()) {
      throw new CtxError("E26", PATH_MISSING(abs));
    }
  } catch (err) {
    if (err instanceof CtxError) throw err;
    throw new CtxError("E26", PATH_MISSING(abs));
  }
  const engine = await readEngine();
  const key = normalizeRepoPath(abs);
  const connected = engine.connected.includes(key)
    ? engine.connected
    : [...engine.connected, key];
  const next: EngineState = { ...engine, connected };
  await writeEngine(next);
  print([
    "",
    "ctx engine — connected",
    "─".repeat(57),
    `  path   : ${abs}`,
    `  linked : ${listConnected(next)}`,
    "─".repeat(57),
    `  Next: cd "${abs}" && node "${path.join(ctxPackageRoot(), "dist", "cli.js")}" on .`,
    "  Then reload that editor window.",
    "",
  ]);
  return next;
}

export async function runUnlink(repoRoot: string): Promise<EngineState> {
  const abs = path.resolve(repoRoot);
  const engine = await readEngine();
  const key = normalizeRepoPath(abs);
  const next: EngineState = {
    ...engine,
    connected: engine.connected.filter((c) => c !== key),
  };
  await writeEngine(next);
  print([
    "",
    "ctx engine — unlinked",
    "─".repeat(57),
    `  path   : ${abs}`,
    `  linked : ${listConnected(next)}`,
    "─".repeat(57),
    "",
  ]);
  return next;
}

export async function engineStatusItems(projectRoot?: string): Promise<StatusItem[]> {
  const engine = await readEngine();
  const items: StatusItem[] = [
    {
      level: engine.running ? "ok" : "warn",
      id: "engine",
      title: engine.running ? "Engine is running" : "Engine is off",
      need: engine.running
        ? undefined
        : `cd "${ctxPackageRoot()}" && npm start`,
    },
  ];
  if (engine.connected.length === 0) {
    items.push({
      level: "warn",
      id: "linked",
      title: "No work repos connected",
      need: `node dist/cli.js connect <path-to-app>`,
    });
  } else {
    items.push({
      level: "ok",
      id: "linked",
      title: `Connected: ${listConnected(engine)}`,
    });
  }
  if (projectRoot && engine.running && !isConnected(engine, projectRoot)) {
    items.push({
      level: "warn",
      id: "this-path",
      title: "This path is not connected to the engine",
      need: `node dist/cli.js connect "${path.resolve(projectRoot)}"`,
    });
  }
  return items;
}
