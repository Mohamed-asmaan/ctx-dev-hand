import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CTX_GATE_SIGNATURES = [
  "ctx — required before any modernization",
  "ctx upgrade gate",
  "This repo opted in. Full instructions live in `.ctx/GATE.md`",
  "HARD CONSTRAINT: ctx is ON only when",
  "ctx ON. This file means ctx is on",
  "description: ctx is ON",
  "Same ctx loop:",
];

export const EDITOR_WIRING = [
  path.join(".cursor", "hooks.json"),
  path.join(".cursor", "rules", "ctx-upgrade-gate.mdc"),
  path.join(".ctx", "GATE.md"),
  path.join(".ctx", "hooks", "ctx-gate.cjs"),
  path.join(".cursor", "hooks", "ctx-gate.cjs"),
  "CLAUDE.md",
];

export const EDITOR_WIRING_DIRS = [path.join(".cursor", "skills", "ctx")];

export const LEGACY_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  path.join(".github", "copilot-instructions.md"),
  path.join(".continue", "rules", "ctx.md"),
];

export const PROJECT_MCP_FILES = [path.join(".cursor", "mcp.json"), ".mcp.json"];

export function gateTmpDir(): string {
  return path.join(os.tmpdir(), "ctx-upgrade-gate");
}

export async function rmIfExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.rm(filePath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsPromises.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: Record<string, unknown>): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function removeCtxMcp(filePath: string): Promise<boolean> {
  const current = await readJson(filePath);
  if (!current) return false;
  const servers =
    typeof current.mcpServers === "object" && current.mcpServers
      ? { ...(current.mcpServers as Record<string, unknown>) }
      : {};
  if (!("ctx" in servers)) return false;
  delete servers.ctx;
  await writeJson(filePath, { ...current, mcpServers: servers });
  return true;
}

function stripCtxGateHooks(hooks: unknown): unknown {
  if (!hooks || typeof hooks !== "object") return hooks;
  const next: Record<string, unknown> = { ...(hooks as Record<string, unknown>) };
  for (const [key, value] of Object.entries(next)) {
    if (!Array.isArray(value)) continue;
    next[key] = value.filter((entry) => !JSON.stringify(entry).includes("ctx-gate"));
  }
  return next;
}

export async function stripProjectClaudeHooks(projectRoot: string): Promise<boolean> {
  const filePath = path.join(projectRoot, ".claude", "settings.json");
  const current = await readJson(filePath);
  if (!current || !("hooks" in current)) return false;
  const stripped = stripCtxGateHooks(current.hooks);
  await writeJson(filePath, { ...current, hooks: stripped });
  return true;
}

function looksLikeCtxInstruction(text: string): boolean {
  return CTX_GATE_SIGNATURES.some((s) => text.includes(s));
}

export async function stripEditorWiring(projectRoot: string): Promise<string[]> {
  const removed: string[] = [];

  for (const rel of PROJECT_MCP_FILES) {
    if (await removeCtxMcp(path.join(projectRoot, rel))) removed.push(rel);
  }

  for (const rel of EDITOR_WIRING) {
    if (await rmIfExists(path.join(projectRoot, rel))) removed.push(rel);
  }
  for (const rel of EDITOR_WIRING_DIRS) {
    if (await rmIfExists(path.join(projectRoot, rel))) removed.push(rel);
  }
  if (await stripProjectClaudeHooks(projectRoot)) {
    removed.push(path.join(".claude", "settings.json"));
  }

  return removed;
}

export async function stripLegacyInstructionFiles(projectRoot: string): Promise<string[]> {
  const removed: string[] = [];
  for (const rel of LEGACY_INSTRUCTION_FILES) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = await fsPromises.readFile(abs, "utf8");
      if (!looksLikeCtxInstruction(raw)) continue;
      await fsPromises.rm(abs, { force: true });
      removed.push(rel);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export async function clearGateMemory(): Promise<boolean> {
  return rmIfExists(gateTmpDir());
}
