// src/mcp/server.ts
// MCP server entry point.
// Registers all ctx tools and connects via stdio transport.
// All logging goes to console.error — stdout is the MCP protocol channel.
// Workspace-aware: every tool requires repoRoot. Never defaults to engine cwd.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProjectStateTool } from "./tools/project-state.js";
import { registerCheckChangeTool } from "./tools/check-change.js";
import { registerUpgradePlanTool } from "./tools/upgrade-plan.js";
import { registerVerifyStepTool } from "./tools/verify-step.js";
import { registerCaptureTool } from "./tools/capture.js";
import { registerVerifyBaselineTool } from "./tools/verify-baseline.js";
import { registerBriefTool } from "./tools/brief.js";
import { registerShowTool } from "./tools/show.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "ctx",
    version: "0.1.0",
  });

  registerProjectStateTool(server);
  registerCheckChangeTool(server);
  registerUpgradePlanTool(server);
  registerVerifyStepTool(server);
  registerCaptureTool(server);
  registerVerifyBaselineTool(server);
  registerBriefTool(server);
  registerShowTool(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[ctx-mcp] Server running on stdio (workspace-aware; pass repoRoot per tool)");
}
