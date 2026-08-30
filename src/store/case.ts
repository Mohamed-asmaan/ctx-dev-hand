// src/store/case.ts
// Read/write helpers for .ctx/case.json. Hashing lives here so no other
// module opens .ctx/ or hashes files for the case file.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CaseFile } from "./schema.js";
import { CtxError } from "./state.js";

const CTX_DIR = ".ctx";
const CASE_FILE = "case.json";

export function casePath(repoRoot: string): string {
  return path.join(repoRoot, CTX_DIR, CASE_FILE);
}

export async function writeCase(repoRoot: string, caseFile: CaseFile): Promise<void> {
  const ctxDir = path.join(repoRoot, CTX_DIR);
  await fs.mkdir(ctxDir, { recursive: true });
  await fs.writeFile(casePath(repoRoot), JSON.stringify(caseFile, null, 2), "utf8");
}

export async function readCase(repoRoot: string): Promise<CaseFile> {
  const filePath = casePath(repoRoot);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    throw new CtxError("E21", "run `ctx capture` first");
  }
  return JSON.parse(raw) as CaseFile;
}

export async function readCaseOptional(repoRoot: string): Promise<CaseFile | null> {
  try {
    return await readCase(repoRoot);
  } catch (err) {
    if (err instanceof CtxError && err.code === "E21") return null;
    throw err;
  }
}

export async function hashFile(absPath: string): Promise<string | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch {
    return null;
  }
  return crypto.createHash("sha256").update(buf).digest("hex");
}
