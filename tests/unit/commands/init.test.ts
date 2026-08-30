import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../../src/commands/init.js";
import { prepareLiveProject, cleanupEngineEnv } from "../../helpers/live-engine.js";

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.CTX_CONFIG_HOME;
  await cleanupEngineEnv();
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function initQuiet(project: string) {
  const configHome = await tempDir("ctx-cfg-");
  process.env.CTX_CONFIG_HOME = configHome;
  await prepareLiveProject(project);
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await runInit(project);
    return { ...result, report: chunks.join(""), configHome };
  } finally {
    process.stdout.write = write;
  }
}

describe("ctx init", () => {
  it("writes portable MCP for this machine into an empty project", async () => {
    const dir = await tempDir("ctx-init-");
    const { env, report, configHome } = await initQuiet(dir);

    const gate = await fs.readFile(path.join(dir, ".ctx", "GATE.md"), "utf8");
    expect(gate).toContain("ctx ON");
    expect(gate).toContain("Never apply a step whose kind is infrastructure");
    expect(gate.length).toBeLessThan(1200);
    const rule = await fs.readFile(path.join(dir, ".cursor", "rules", "ctx-upgrade-gate.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    expect(rule).not.toMatch(/config\.json/);
    expect(rule).not.toMatch(/ignore ctx/i);
    expect(rule).not.toContain("GATE.md");
    await expect(fs.access(path.join(dir, ".cursor", "skills", "ctx"))).rejects.toThrow();

    const mcp = JSON.parse(await fs.readFile(path.join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: { ctx: { command: string; args: string[] } };
    };
    expect(mcp.mcpServers.ctx.command).toBe("node");
    expect(mcp.mcpServers.ctx.args[0]).toBe(env.mcpCli.replace(/\\/g, "/"));
    await fs.access(mcp.mcpServers.ctx.args[0]);
    await fs.access(path.join(dir, ".ctx", "hooks", "ctx-gate.cjs"));
    await fs.access(path.join(dir, "CLAUDE.md"));
    await fs.access(path.join(dir, ".mcp.json"));
    await expect(fs.access(path.join(dir, "AGENTS.md"))).rejects.toThrow();
    expect(report).toMatch(/Node\.js/);
    expect(report).toMatch(/Need:|Ready on this machine/);

    const config = JSON.parse(await fs.readFile(path.join(dir, ".ctx", "config.json"), "utf8")) as {
      enabled: boolean;
    };
    expect(config.enabled).toBe(true);

    await expect(fs.access(path.join(configHome, ".cursor", "mcp.json"))).rejects.toThrow();
    await expect(fs.access(path.join(configHome, ".cursor", "hooks.json"))).rejects.toThrow();
    await expect(fs.access(path.join(configHome, ".cursor", "skills", "ctx"))).rejects.toThrow();
    await expect(fs.access(path.join(configHome, ".claude", "settings.json"))).rejects.toThrow();
  });

  it("strips leftover user-level ctx MCP and does not reattach it", async () => {
    const dir = await tempDir("ctx-init-strip-");
    const configHome = await tempDir("ctx-cfg-strip-");
    process.env.CTX_CONFIG_HOME = configHome;
    await prepareLiveProject(dir);
    await fs.mkdir(path.join(configHome, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(configHome, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          webflow: { url: "https://mcp.webflow.com/mcp" },
          ctx: { command: "node", args: ["dist/mcp-cli.js"] },
        },
      }),
      "utf8",
    );
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runInit(dir);
    } finally {
      process.stdout.write = write;
    }
    const userMcp = JSON.parse(
      await fs.readFile(path.join(configHome, ".cursor", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, unknown> };
    expect(userMcp.mcpServers.ctx).toBeUndefined();
    expect(userMcp.mcpServers.webflow).toBeDefined();
  });

  it("re-init restores GATE.md so on/off stays stable", async () => {
    const dir = await tempDir("ctx-init-custom-");
    await initQuiet(dir);
    await fs.writeFile(path.join(dir, ".ctx", "GATE.md"), "# stale\n", "utf8");
    await initQuiet(dir);
    const gate = await fs.readFile(path.join(dir, ".ctx", "GATE.md"), "utf8");
    expect(gate).toContain("ctx ON");
    expect(gate).toContain("Never apply a step whose kind is infrastructure");
  });

  it("doctor warns about leftover user-level hooks", async () => {
    const dir = await tempDir("ctx-doc-leak-");
    const configHome = await tempDir("ctx-cfg-leak-");
    process.env.CTX_CONFIG_HOME = configHome;
    await fs.mkdir(path.join(configHome, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(configHome, ".cursor", "hooks.json"),
      JSON.stringify({ hooks: { sessionStart: [{ command: "node ctx-gate.cjs" }] } }),
      "utf8",
    );
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runInit(dir, { doctorOnly: true });
    } finally {
      process.stdout.write = write;
    }
    expect(chunks.join("")).toMatch(/User-level Cursor hooks still run ctx/);
  });

  it("uses relative dist/mcp-cli.js when initializing the ctx package itself", async () => {
    const dir = await tempDir("ctx-pkg-");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "ctx" }), "utf8");
    await initQuiet(dir);
    const mcp = JSON.parse(await fs.readFile(path.join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: { ctx: { args: string[] } };
    };
    expect(mcp.mcpServers.ctx.args[0]).toBe("dist/mcp-cli.js");
  });

  it("keeps other MCP servers when merging", async () => {
    const dir = await tempDir("ctx-merge-");
    await fs.mkdir(path.join(dir, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "npx", args: ["-y", "other"] } } }),
      "utf8",
    );
    await initQuiet(dir);
    const mcp = JSON.parse(await fs.readFile(path.join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(mcp.mcpServers.other).toBeDefined();
    expect(mcp.mcpServers.ctx).toBeDefined();
  });

  it("doctor-only reports without writing project files", async () => {
    const dir = await tempDir("ctx-doc-");
    process.env.CTX_CONFIG_HOME = await tempDir("ctx-cfg-");
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runInit(dir, { doctorOnly: true });
    } finally {
      process.stdout.write = write;
    }
    await expect(fs.access(path.join(dir, ".ctx", "GATE.md"))).rejects.toThrow();
    expect(chunks.join("")).toMatch(/Node\.js/);
  });
});
