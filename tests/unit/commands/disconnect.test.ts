import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDisconnect } from "../../../src/commands/disconnect.js";

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.CTX_CONFIG_HOME;
  await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("ctx disconnect", () => {
  it("removes user-level ctx and keeps other MCP servers", async () => {
    const home = await tempDir("ctx-disc-");
    process.env.CTX_CONFIG_HOME = home;
    await fs.mkdir(path.join(home, ".cursor", "skills", "ctx"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          webflow: { url: "https://mcp.webflow.com/mcp" },
          ctx: { command: "node", args: ["x"] },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(home, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ command: "node ctx-gate.cjs" }] },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(home, ".cursor", "skills", "ctx", "SKILL.md"), "gate", "utf8");

    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runDisconnect();
    } finally {
      process.stdout.write = write;
    }

    const mcp = JSON.parse(await fs.readFile(path.join(home, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(mcp.mcpServers.ctx).toBeUndefined();
    expect(mcp.mcpServers.webflow).toBeDefined();
    const hooks = await fs.readFile(path.join(home, ".cursor", "hooks.json"), "utf8");
    expect(hooks).not.toContain("ctx-gate");
    await expect(fs.access(path.join(home, ".cursor", "skills", "ctx"))).rejects.toThrow();
  });
});
