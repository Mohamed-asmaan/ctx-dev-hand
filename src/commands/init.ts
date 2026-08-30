import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  detectEnvironment,
  formatInitReport,
  tryBuildCtx,
  type MachineEnv,
  type StatusItem,
} from "./environment.js";
import { isCtxEnabled, writeConfig } from "../store/config.js";
import { stripUserLevelCtx } from "./disconnect.js";
import { assertConnected } from "../store/engine.js";
import { engineStatusItems } from "./engine.js";
import { CTX_GATE_MD, CTX_RULE_MDC } from "../prompt.js";
import { rmIfExists, stripLegacyInstructionFiles } from "./wiring.js";

export interface InitOptions {
  doctorOnly?: boolean;
}

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isCtxProject(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name?: string;
    };
    return pkg.name === "ctx";
  } catch {
    return false;
  }
}

function mcpEntry(
  env: MachineEnv,
  projectRoot: string,
): { command: string; args: string[] } {
  if (isCtxProject(projectRoot) || path.resolve(projectRoot) === path.resolve(env.ctxHome)) {
    return { command: "node", args: ["dist/mcp-cli.js"] };
  }
  return { command: "node", args: [posix(env.mcpCli)] };
}

async function mergeJson(
  filePath: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await fsPromises.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(mutate(current), null, 2)}\n`, "utf8");
}

async function writeIfMissing(filePath: string, contents: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return false;
  } catch {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, contents, "utf8");
    return true;
  }
}

async function writeAlways(filePath: string, contents: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, contents, "utf8");
}

function leakItems(env: MachineEnv): StatusItem[] {
  const items: StatusItem[] = [];
  const userHooks = path.join(env.cursorConfigDir, "hooks.json");
  if (fs.existsSync(userHooks)) {
    try {
      const raw = fs.readFileSync(userHooks, "utf8");
      if (raw.includes("ctx-gate")) {
        items.push({
          level: "warn",
          id: "user-hooks",
          title: "User-level Cursor hooks still run ctx in every repo",
          need: `Run ctx disconnect, then reload every Cursor window`,
        });
      }
    } catch {
      /* ignore unreadable hooks */
    }
  }

  const userSkill = path.join(env.cursorConfigDir, "skills", "ctx");
  if (fs.existsSync(userSkill)) {
    items.push({
      level: "warn",
      id: "user-skill",
      title: "User-level ctx skill is installed for every workspace",
      need: `Run ctx disconnect, then reload every Cursor window`,
    });
  }

  const userMcp = path.join(env.cursorConfigDir, "mcp.json");
  if (fs.existsSync(userMcp)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(userMcp, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed.mcpServers && "ctx" in parsed.mcpServers) {
        items.push({
          level: "warn",
          id: "user-mcp",
          title: "User-level ctx MCP is attached for every workspace",
          need: `Run ctx disconnect, then reload every Cursor window`,
        });
      }
    } catch {
      /* ignore */
    }
  }

  const claudeSettings = path.join(env.claudeConfigDir, "settings.json");
  if (fs.existsSync(claudeSettings)) {
    try {
      const raw = fs.readFileSync(claudeSettings, "utf8");
      if (raw.includes("ctx-gate")) {
        items.push({
          level: "warn",
          id: "claude-user-hooks",
          title: "Claude Code user settings still run ctx in every repo",
          need: `Run ctx disconnect, then reload every Cursor window`,
        });
      }
    } catch {
      /* ignore */
    }
  }

  return items;
}

async function projectItems(projectRoot: string): Promise<StatusItem[]> {
  const on = await isCtxEnabled(projectRoot);
  return [
    {
      level: on ? "ok" : "warn",
      id: "opt-in",
      title: on ? "ctx is on in this repo" : "ctx is off in this repo",
      need: on ? undefined : `Run ctx on in "${projectRoot}"`,
    },
  ];
}

function assessEnv(env: MachineEnv): StatusItem[] {
  const items: StatusItem[] = [];

  if (env.nodeMajor < 18) {
    items.push({
      level: "err",
      id: "node",
      title: `Node.js ${env.nodeVersion} is too old`,
      need: "Install Node.js 18 or newer from https://nodejs.org then re-run ctx init",
    });
  } else {
    items.push({
      level: "ok",
      id: "node",
      title: `Node.js ${env.nodeVersion}`,
    });
  }

  if (!env.npmVersion) {
    items.push({
      level: "err",
      id: "npm",
      title: "npm is not on PATH",
      need: "Install npm (comes with Node.js) and re-run ctx init",
    });
  } else {
    items.push({ level: "ok", id: "npm", title: `npm ${env.npmVersion}` });
  }

  if (!env.sdkInstalled) {
    items.push({
      level: "err",
      id: "deps",
      title: "ctx dependencies are not installed",
      need: `cd "${env.ctxHome}" && npm install`,
    });
  } else {
    items.push({ level: "ok", id: "deps", title: "ctx dependencies installed" });
  }

  if (!env.distMcpExists || !env.distCliExists) {
    items.push({
      level: "err",
      id: "build",
      title: "ctx is not built (dist/ missing)",
      need: `cd "${env.ctxHome}" && npm install && npm run build`,
    });
  } else {
    items.push({ level: "ok", id: "build", title: "ctx CLI and MCP binaries exist" });
  }

  if (!env.hookSrcExists) {
    items.push({
      level: "err",
      id: "hook",
      title: "gate hook script is missing from the ctx install",
      need: `Re-clone or copy .cursor/hooks/ctx-gate.cjs into ${env.ctxHome}`,
    });
  } else {
    items.push({ level: "ok", id: "hook", title: "gate hook script found" });
  }

  const editorNames = Object.entries(env.editors)
    .filter(([, on]) => on)
    .map(([name]) => name);
  if (editorNames.length === 0) {
    items.push({
      level: "miss",
      id: "editor",
      title: "No supported editor detected (Cursor, Claude Code, VS Code, Windsurf)",
      need: "Install Cursor or Claude Code, open this folder, approve the ctx MCP server, reload",
    });
  } else {
    items.push({
      level: "ok",
      id: "editor",
      title: `Editors detected: ${editorNames.join(", ")}`,
      detail: "Approve the ctx MCP server in the editor, then reload the window",
    });
  }

  return items;
}

export async function runInit(
  repoRoot: string,
  options: InitOptions = {},
): Promise<{ items: StatusItem[]; env: MachineEnv }> {
  const projectRoot = path.resolve(repoRoot);
  let env = detectEnvironment();

  if (!env.distMcpExists && env.npmVersion && env.sdkInstalled && !options.doctorOnly) {
    const built = tryBuildCtx(env.ctxHome);
    env = detectEnvironment();
    if (!built.ok && !env.distMcpExists) {
      /* assessEnv will flag the missing build */
    }
  }

  const items = [
    ...assessEnv(env),
    ...(await engineStatusItems(projectRoot)),
    ...leakItems(env),
  ];

  if (options.doctorOnly) {
    items.push(...(await projectItems(projectRoot)));
    process.stdout.write(formatInitReport(env, items, projectRoot));
    if (items.some((i) => i.level === "err")) process.exitCode = 1;
    return { items, env };
  }

  await assertConnected(projectRoot);

  const mcp = mcpEntry(env, projectRoot);
  const hookRel = ".ctx/hooks/ctx-gate.cjs";

  const hooksJson = {
    version: 1,
    hooks: {
      sessionStart: [{ command: `node ${hookRel}` }],
      beforeSubmitPrompt: [{ command: `node ${hookRel}` }],
      afterMCPExecution: [{ command: `node ${hookRel}` }],
      afterToolUse: [{ command: `node ${hookRel}` }],
      preToolUse: [
        {
          command: `node ${hookRel}`,
          matcher: "Write|StrReplace|EditNotebook|Delete|Edit|MultiEdit|Shell",
        },
      ],
      sessionEnd: [{ command: `node ${hookRel}` }],
    },
  };

  const claudeSettings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: `node ${hookRel}` }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: `node ${hookRel}` }] }],
      PostToolUse: [{ hooks: [{ type: "command", command: `node ${hookRel}` }] }],
      PreToolUse: [
        {
          matcher: "Write|Edit|MultiEdit|Bash",
          hooks: [{ type: "command", command: `node ${hookRel}` }],
        },
      ],
    },
  };

  const written: string[] = [];
  // ctx-owned files live under .ctx/. Editor adapters stay in the paths those
  // tools actually load (Cursor will not read a rule from .ctx/).
  // One alwaysApply rule. No skill (it would duplicate the rule and cost tokens).
  // File existing = ON. ctx off deletes the file. Do not write "if off ignore".
  const files: Array<[string, string, boolean]> = [
    [".ctx/GATE.md", CTX_GATE_MD, true],
    [".cursor/rules/ctx-upgrade-gate.mdc", CTX_RULE_MDC, true],
    [".cursor/hooks.json", `${JSON.stringify(hooksJson, null, 2)}\n`, true],
    [".claude/settings.json", `${JSON.stringify(claudeSettings, null, 2)}\n`, true],
  ];

  for (const [rel, contents, always] of files) {
    const dest = path.join(projectRoot, rel);
    if (always) {
      await writeAlways(dest, contents);
      written.push(rel);
    } else if (await writeIfMissing(dest, contents)) {
      written.push(rel);
    }
  }

  const writeMcp = async (
    filePath: string,
    entry: { command: string; args: string[] },
  ) => {
    await mergeJson(filePath, (current) => {
      const servers =
        typeof current.mcpServers === "object" && current.mcpServers
          ? (current.mcpServers as Record<string, unknown>)
          : {};
      servers.ctx = entry;
      return { ...current, mcpServers: servers };
    });
  };

  await writeMcp(path.join(projectRoot, ".cursor", "mcp.json"), mcp);
  written.push(".cursor/mcp.json");
  await writeMcp(path.join(projectRoot, ".mcp.json"), mcp);
  written.push(".mcp.json");

  if (await rmIfExists(path.join(projectRoot, ".cursor", "skills", "ctx"))) {
    written.push(".cursor/skills/ctx (removed leftover skill)");
  }

  const strippedLegacy = await stripLegacyInstructionFiles(projectRoot);
  if (strippedLegacy.length > 0) {
    written.push(...strippedLegacy.map((f) => `${f} (removed leftover)`));
  }

  // After leftover cleanup: IBM Bob / Claude Code read CLAUDE.md at the repo root.
  // Writing it before stripLegacy would delete it (same signatures as GATE.md).
  await writeAlways(path.join(projectRoot, "CLAUDE.md"), CTX_GATE_MD);
  written.push("CLAUDE.md");

  await writeConfig(projectRoot, { schemaVersion: 1, enabled: true });
  written.push(".ctx/config.json");

  if (env.hookSrcExists) {
    const hookDest = path.join(projectRoot, hookRel);
    await fsPromises.mkdir(path.dirname(hookDest), { recursive: true });
    await fsPromises.copyFile(env.hookSrc, hookDest);
    written.push(hookRel);
  }

  const stripped = await stripUserLevelCtx(env);
  if (stripped.length > 0) {
    items.push({
      level: "ok",
      id: "user-clean",
      title: "Removed leftover user-level ctx (it must not follow other repos)",
      detail: stripped.join(", "),
    });
  }

  items.push({
    level: "ok",
    id: "files",
    title: `Wrote ${written.length} project files`,
    detail: `MCP command: ${mcp.command} ${mcp.args.join(" ")}`,
  });

  if (env.distMcpExists) {
    items.push({
      level: "warn",
      id: "reload",
      title: "Editor must reload before MCP and hooks load",
      need: "Reload Cursor / Claude Code, then enable the ctx MCP server if asked",
    });
  }

  items.push(...(await projectItems(projectRoot)));

  process.stdout.write(formatInitReport(env, items, projectRoot));
  if (items.some((i) => i.level === "err")) process.exitCode = 1;
  return { items, env };
}

export const runOn = runInit;

export async function runDoctor(repoRoot: string): Promise<void> {
  await runInit(repoRoot, { doctorOnly: true });
}
