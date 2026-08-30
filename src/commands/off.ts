import fs from "node:fs";
import path from "node:path";
import { writeConfig } from "../store/config.js";
import { CTX_DIR } from "../store/config.js";
import { clearGateMemory, rmIfExists, stripEditorWiring } from "./wiring.js";

export interface OffOptions {
  purge?: boolean;
}

export async function runOff(
  repoRoot: string,
  options: OffOptions = {},
): Promise<{ removed: string[]; kept: string[] }> {
  const projectRoot = path.resolve(repoRoot);
  const removed: string[] = [];
  const kept: string[] = [];

  await writeConfig(projectRoot, { schemaVersion: 1, enabled: false });
  removed.push(".ctx/config.json (enabled: false)");
  removed.push(...(await stripEditorWiring(projectRoot)));
  if (await clearGateMemory()) removed.push("(gate temp memory)");

  const stateRel = path.join(CTX_DIR, "state.json");
  const caseRel = path.join(CTX_DIR, "case.json");
  const cacheRel = path.join(CTX_DIR, "cache");

  if (options.purge) {
    for (const rel of [stateRel, caseRel, cacheRel]) {
      if (await rmIfExists(path.join(projectRoot, rel))) removed.push(rel);
    }
  } else {
    for (const rel of [stateRel, caseRel]) {
      if (fs.existsSync(path.join(projectRoot, rel))) kept.push(rel);
    }
  }

  const lines = [
    "",
    "ctx off — this repo",
    "─".repeat(57),
    `  project : ${projectRoot}`,
    `  status  : disabled`,
    "  AI wiring removed (rules, skills, hooks, MCP). Do not call ctx.",
    ...removed.map((r) => `  removed : ${r}`),
    ...kept.map((k) => `  kept    : ${k}`),
    options.purge ? "  truth   : purged" : "  truth   : kept (ctx remove deletes everything)",
    "─".repeat(57),
    "  Reload this window. Open a new chat — old chats still remember ctx.",
    "  Run ctx on to enable this repo again.",
    "",
  ];
  process.stdout.write(lines.join("\n"));
  return { removed, kept };
}
