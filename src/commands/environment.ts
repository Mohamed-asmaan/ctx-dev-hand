import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type StatusLevel = "ok" | "warn" | "miss" | "err";

export interface StatusItem {
  level: StatusLevel;
  id: string;
  title: string;
  detail?: string;
  need?: string;
}

export interface EditorsFound {
  cursor: boolean;
  claude: boolean;
  vscode: boolean;
  windsurf: boolean;
}

export interface MachineEnv {
  os: NodeJS.Platform;
  home: string;
  nodeVersion: string;
  nodeMajor: number;
  nodePath: string;
  npmVersion: string | null;
  ctxHome: string;
  mcpCli: string;
  distCli: string;
  hookSrc: string;
  distCliExists: boolean;
  distMcpExists: boolean;
  hookSrcExists: boolean;
  sdkInstalled: boolean;
  editors: EditorsFound;
  cursorConfigDir: string;
  claudeConfigDir: string;
}

export function ctxPackageRoot(): string {
  return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function commandExists(cmd: string): boolean {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [cmd], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

function npmVersion(): string | null {
  const result = spawnSync("npm", ["-v"], {
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim() || null;
}

function findHookSrc(ctxHome: string): string {
  const candidates = [
    path.join(ctxHome, "scripts", "ctx-gate.cjs"),
    path.join(ctxHome, ".cursor", "hooks", "ctx-gate.cjs"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

export function detectEnvironment(homeDir = process.env.CTX_CONFIG_HOME || os.homedir()): MachineEnv {
  const ctxHome = ctxPackageRoot();
  const home = homeDir;
  const mcpCli = path.join(ctxHome, "dist", "mcp-cli.js");
  const distCli = path.join(ctxHome, "dist", "cli.js");
  const hookSrc = findHookSrc(ctxHome);
  const cursorConfigDir = path.join(home, ".cursor");
  const claudeConfigDir = path.join(home, ".claude");
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  return {
    os: process.platform,
    home,
    nodeVersion: process.versions.node,
    nodeMajor,
    nodePath: process.execPath,
    npmVersion: npmVersion(),
    ctxHome,
    mcpCli,
    distCli,
    hookSrc,
    distCliExists: fs.existsSync(distCli),
    distMcpExists: fs.existsSync(mcpCli),
    hookSrcExists: fs.existsSync(hookSrc),
    sdkInstalled: fs.existsSync(
      path.join(ctxHome, "node_modules", "@modelcontextprotocol", "sdk"),
    ),
    editors: {
      cursor: commandExists("cursor") || fs.existsSync(cursorConfigDir),
      claude: commandExists("claude") || fs.existsSync(claudeConfigDir),
      vscode: commandExists("code"),
      windsurf: commandExists("windsurf") || fs.existsSync(path.join(home, ".windsurf")),
    },
    cursorConfigDir,
    claudeConfigDir,
  };
}

export function tryBuildCtx(ctxHome: string): { ok: boolean; output: string } {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: ctxHome,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

export function formatInitReport(
  env: MachineEnv,
  items: StatusItem[],
  projectRoot: string,
): string {
  const label = { ok: "OK  ", warn: "WARN", miss: "MISS", err: "ERR " };
  const lines: string[] = [];
  lines.push("");
  lines.push("ctx init — this machine");
  lines.push("─".repeat(57));
  lines.push(`  OS        : ${env.os}`);
  lines.push(`  Node      : ${env.nodeVersion}  (${env.nodePath})`);
  lines.push(`  npm       : ${env.npmVersion ?? "not found"}`);
  lines.push(`  ctx home  : ${env.ctxHome}`);
  lines.push(`  project   : ${projectRoot}`);
  lines.push("─".repeat(57));

  for (const item of items) {
    lines.push(`  ${label[item.level]}  ${item.title}`);
    if (item.detail) lines.push(`        ${item.detail}`);
    if (item.need) lines.push(`        Need: ${item.need}`);
  }

  const errs = items.filter((i) => i.level === "err");
  const misses = items.filter((i) => i.level === "miss");
  const needs = items.filter((i) => i.need).map((i) => i.need as string);

  lines.push("─".repeat(57));
  if (errs.length === 0 && misses.length === 0) {
    lines.push("  Ready on this machine. Reload the editor, then approve the ctx MCP server.");
  } else {
    lines.push(`  Not fully ready — ${errs.length} error(s), ${misses.length} missing.`);
  }
  if (needs.length > 0) {
    lines.push("  Do this next:");
    for (const [i, need] of [...new Set(needs)].entries()) {
      lines.push(`    ${i + 1}. ${need}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
