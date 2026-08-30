// tests/contract/guardrails.test.ts
// Architecture guardrails:
//   1. No module in src/compat/ may import from src/readers/
//   2. No source file may contain "anthropic" or "openai" (case-insensitive)
//   3. All MCP tool descriptions contain the required grounding instruction

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

async function readDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

const GROUNDING_PHRASE = "Return only the facts present in this response";

async function readSourceFiles(dir: string, ext = ".ts"): Promise<Map<string, string>> {
  const allFiles = await readDir(dir);
  const result = new Map<string, string>();
  for (const f of allFiles.filter((x) => x.endsWith(ext))) {
    result.set(f, await fs.readFile(f, "utf8"));
  }
  return result;
}

// ── Contract 1: src/compat/ must not import from src/readers/ ────────────────

describe("Contract 1 — compat layer must not import readers or adapters", () => {
  it("src/compat/*.ts files contain no import from readers or adapters", async () => {
    const compatFiles = await readSourceFiles(path.resolve("src/compat"));
    const violations: string[] = [];
    for (const [filePath, content] of compatFiles) {
      if (
        content.includes("../readers") ||
        content.includes("src/readers") ||
        content.includes("../adapters") ||
        content.includes("src/adapters")
      ) {
        violations.push(path.relative(process.cwd(), filePath));
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── Contract 2: no AI SDK in any source file ──────────────────────────────────

describe("Contract 2 — no AI SDK dependencies in source", () => {
  it("no src/**/*.ts file contains 'anthropic' (case-insensitive)", async () => {
    const srcFiles = await readSourceFiles(path.resolve("src"));
    const violations: string[] = [];
    for (const [filePath, content] of srcFiles) {
      if (/anthropic/i.test(content)) {
        violations.push(path.relative(process.cwd(), filePath));
      }
    }
    expect(violations).toEqual([]);
  });

  it("no src/**/*.ts file contains 'openai' (case-insensitive)", async () => {
    const srcFiles = await readSourceFiles(path.resolve("src"));
    const violations: string[] = [];
    for (const [filePath, content] of srcFiles) {
      if (/openai/i.test(content)) {
        violations.push(path.relative(process.cwd(), filePath));
      }
    }
    expect(violations).toEqual([]);
  });

  it("package.json does not depend on @anthropic-ai/* or openai", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    });
    const aiDeps = allDeps.filter((d) => /anthropic|openai/i.test(d));
    expect(aiDeps).toEqual([]);
  });
});

// ── Contract 3: MCP tool descriptions contain grounding instruction ──────────

describe("Contract 3 — grounding instruction in all MCP tool descriptions", () => {
  it("project-state.ts contains grounding instruction", async () => {
    const content = await fs.readFile("src/mcp/tools/project-state.ts", "utf8");
    expect(content.includes(GROUNDING_PHRASE) || content.includes("GROUNDING_INSTRUCTION")).toBe(true);
  });

  it("check-change.ts contains grounding instruction", async () => {
    const content = await fs.readFile("src/mcp/tools/check-change.ts", "utf8");
    expect(content.includes(GROUNDING_PHRASE) || content.includes("GROUNDING_INSTRUCTION")).toBe(true);
  });

  it("upgrade-plan.ts contains grounding instruction", async () => {
    const content = await fs.readFile("src/mcp/tools/upgrade-plan.ts", "utf8");
    expect(content.includes(GROUNDING_PHRASE) || content.includes("GROUNDING_INSTRUCTION")).toBe(true);
  });

  const WORKFLOW = "MANDATORY WORKFLOW: Before modifying any file for a version upgrade";

  it("every MCP tool includes the mandatory workflow", async () => {
    const grounding = await fs.readFile("src/mcp/grounding.ts", "utf8");
    expect(grounding).toContain(WORKFLOW);
    for (const file of [
      "src/mcp/tools/project-state.ts",
      "src/mcp/tools/check-change.ts",
      "src/mcp/tools/upgrade-plan.ts",
      "src/mcp/tools/verify-step.ts",
      "src/mcp/tools/capture.ts",
      "src/mcp/tools/verify-baseline.ts",
      "src/mcp/tools/brief.ts",
      "src/mcp/tools/show.ts",
    ]) {
      const content = await fs.readFile(file, "utf8");
      expect(
        content.includes(WORKFLOW) || content.includes("MANDATORY_WORKFLOW"),
        file,
      ).toBe(true);
    }
  });

  it("grounding names IBM Bob and the capture-verify-brief loop", async () => {
    const content = await fs.readFile("src/mcp/grounding.ts", "utf8");
    expect(content).toContain("IBM Bob");
    expect(content).toContain("ctx_capture");
    expect(content).toContain("ctx_show");
    expect(content).toContain("ctx_verify");
    expect(content).toContain("ctx_brief");
  });
});

// ── Contract 4: all MCP logging uses console.error, not console.log ──────────

describe("Contract 4 — MCP server uses stderr for logging", () => {
  it("verify-step.ts contains grounding instruction", async () => {
    const content = await fs.readFile("src/mcp/tools/verify-step.ts", "utf8");
    expect(content.includes(GROUNDING_PHRASE) || content.includes("GROUNDING_INSTRUCTION")).toBe(true);
  });

  it("src/mcp/server.ts has no console.log calls", async () => {
    const content = await fs.readFile("src/mcp/server.ts", "utf8");
    // console.error is fine; console.log is not (stdout = MCP protocol channel)
    const lines = content.split("\n");
    const violations = lines.filter((line) =>
      /console\.log/.test(line) && !line.trim().startsWith("//"),
    );
    expect(violations).toEqual([]);
  });
});

// ── Contract 5: only store layer writes state.json / cache directly ──────────

describe("Contract 6 — stack-specific tokens stay inside adapters", () => {
  it("no src file outside src/adapters/ mentions pom, maven, or .java", async () => {
    const srcFiles = await readSourceFiles(path.resolve("src"));
    const violations: string[] = [];
    const banned = /\bpom\b|\bmaven\b|\.java\b/i;
    for (const [filePath, content] of srcFiles) {
      const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      if (rel.startsWith("src/adapters/")) continue;
      if (banned.test(content)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("Contract 5 — only store layer writes .ctx/state.json directly", () => {
  it("no file outside src/store/ calls fs.writeFile with state.json", async () => {
    const srcFiles = await readSourceFiles(path.resolve("src"));
    const violations: string[] = [];
    for (const [filePath, content] of srcFiles) {
      const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      if (rel.startsWith("src/store/")) continue; // allowed
      // Detect direct writes to state.json outside the store layer
      if (/writeFile[^;]*state\.json/.test(content)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
