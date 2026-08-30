// Resolves the open project for MCP tools. Never falls back to the engine cwd.

import path from "node:path";
import { CtxError } from "../store/state.js";
import { assertConnected } from "../store/engine.js";
import { isCtxEnabled } from "../store/config.js";
import { NOT_ENABLED, REPO_ROOT_REQUIRED } from "../messages.js";

export { NOT_ENABLED, REPO_ROOT_REQUIRED };

export async function requireWorkspace(repoRoot: string | undefined): Promise<string> {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new CtxError("E23", REPO_ROOT_REQUIRED);
  }
  const root = path.resolve(repoRoot);
  await assertConnected(root);
  if (!(await isCtxEnabled(root))) {
    throw new CtxError("E22", NOT_ENABLED);
  }
  return root;
}

export function asMcpError(err: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} | null {
  if (err instanceof CtxError) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message }) }],
      isError: true,
    };
  }
  return null;
}
