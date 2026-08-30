// src/store/state.ts
// Read/write helpers for .ctx/state.json.
// No other module opens .ctx/ directly — all access goes through here.

import fs from "node:fs/promises";
import path from "node:path";
import type { StateJson } from "./schema.js";

const CTX_DIR = ".ctx";
const STATE_FILE = "state.json";

export class CtxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CtxError";
  }
}

export async function writeState(
  repoRoot: string,
  state: StateJson,
): Promise<void> {
  const ctxDir = path.join(repoRoot, CTX_DIR);
  await fs.mkdir(ctxDir, { recursive: true });
  const filePath = path.join(ctxDir, STATE_FILE);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function readState(repoRoot: string): Promise<StateJson> {
  const filePath = path.join(repoRoot, CTX_DIR, STATE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    throw new CtxError("E16", "run `ctx scan` first");
  }
  return JSON.parse(raw) as StateJson;
}
