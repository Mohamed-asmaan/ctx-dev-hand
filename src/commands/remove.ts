import path from "node:path";
import { detectEnvironment } from "./environment.js";
import { stripUserLevelCtx } from "./disconnect.js";
import {
  clearGateMemory,
  rmIfExists,
  stripEditorWiring,
  stripLegacyInstructionFiles,
} from "./wiring.js";
import { CTX_DIR } from "../store/config.js";

export async function runRemove(repoRoot: string): Promise<{ removed: string[] }> {
  const projectRoot = path.resolve(repoRoot);
  const env = detectEnvironment();
  const removed: string[] = [];

  removed.push(...(await stripEditorWiring(projectRoot)));
  removed.push(...(await stripLegacyInstructionFiles(projectRoot)));

  const ctxDir = path.join(projectRoot, CTX_DIR);
  if (await rmIfExists(ctxDir)) removed.push(".ctx/");

  removed.push(...(await stripUserLevelCtx(env)));
  if (await clearGateMemory()) removed.push("(gate temp memory)");

  const lines = [
    "",
    "ctx remove — kill switch",
    "─".repeat(57),
    `  project : ${projectRoot}`,
    "  status  : gone",
    "  Every project ctx file, leftover instruction file, user-level MCP/hook/skill,",
    "  and gate temp file was cleared.",
    ...removed.map((r) => `  removed : ${r}`),
    removed.length === 0 ? "  removed : (nothing left)" : "",
    "─".repeat(57),
    "  Reload EVERY Cursor window.",
    "  Open a NEW chat. Old chats still remember ctx — that memory is in the thread, not disk.",
    "",
  ];
  process.stdout.write(lines.join("\n"));
  return { removed };
}
