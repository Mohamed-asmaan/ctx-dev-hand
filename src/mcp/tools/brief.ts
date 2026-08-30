import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { briefCase } from "../../commands/brief.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export function registerBriefTool(server: McpServer): void {
  server.registerTool(
    "ctx_brief",
    {
      description:
        `Short local summary from the case file (about 10 lines). ` +
        `Use this instead of explaining the whole repo. This is the handoff for the next person. ` +
        `${MANDATORY_WORKFLOW} ${GROUNDING_INSTRUCTION}`,
      inputSchema: z.object({
        repoRoot: z
          .string()
          .describe("Path to the open project root. Required. Never omit this or use the ctx engine directory."),
      }),
    },
    async (input) => {
      try {
        const root = await requireWorkspace(input.repoRoot);
        const { text } = await briefCase(root);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
    },
  );
}
