import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { detectEnvironment, type MachineEnv } from "./environment.js";

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

function stripCtxGate(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => !JSON.stringify(entry).includes("ctx-gate"));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      next[key] = stripCtxGate(child);
    }
    return next;
  }
  return value;
}

export async function stripUserLevelCtx(env: MachineEnv): Promise<string[]> {
  const removed: string[] = [];

  const mcpPath = path.join(env.cursorConfigDir, "mcp.json");
  const mcp = await readJson(mcpPath);
  if (mcp) {
    const servers =
      typeof mcp.mcpServers === "object" && mcp.mcpServers
        ? { ...(mcp.mcpServers as Record<string, unknown>) }
        : {};
    if ("ctx" in servers) {
      delete servers.ctx;
      await writeJson(mcpPath, { ...mcp, mcpServers: servers });
      removed.push(mcpPath);
    }
  }

  const hooksPath = path.join(env.cursorConfigDir, "hooks.json");
  if (fs.existsSync(hooksPath)) {
    try {
      const raw = await fsPromises.readFile(hooksPath, "utf8");
      if (raw.includes("ctx-gate")) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const hooks = stripCtxGate(parsed.hooks);
        await writeJson(hooksPath, { ...parsed, hooks: hooks ?? {} });
        removed.push(hooksPath);
      }
    } catch {
      /* leave unreadable hooks alone */
    }
  }

  const skillDir = path.join(env.cursorConfigDir, "skills", "ctx");
  if (fs.existsSync(skillDir)) {
    await fsPromises.rm(skillDir, { recursive: true, force: true });
    removed.push(skillDir);
  }

  const claudePath = path.join(env.claudeConfigDir, "settings.json");
  if (fs.existsSync(claudePath)) {
    try {
      const raw = await fsPromises.readFile(claudePath, "utf8");
      if (raw.includes("ctx-gate")) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        await writeJson(claudePath, { ...parsed, hooks: stripCtxGate(parsed.hooks) });
        removed.push(claudePath);
      }
    } catch {
      /* ignore */
    }
  }

  return removed;
}

export async function runDisconnect(): Promise<string[]> {
  const env = detectEnvironment();
  const removed = await stripUserLevelCtx(env);
  const lines = [
    "",
    "ctx disconnect — this machine",
    "─".repeat(57),
    "  ctx is no longer attached at user level.",
    "  Other editors / chat tabs keep their own running process until reload.",
    ...removed.map((r) => `  removed : ${r}`),
    removed.length === 0 ? "  removed : (nothing left at user level)" : "",
    "─".repeat(57),
    "  Reload EVERY Cursor window (Developer: Reload Window).",
    "  Then ctx only appears in a repo after `ctx on`.",
    "",
  ].filter((line) => line !== undefined);
  process.stdout.write(lines.join("\n"));
  return removed;
}
