import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyCase } from "../../commands/verify.js";
import { formatVerifyReport } from "../../case/report.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export function registerVerifyBaselineTool(server: McpServer): void {
  server.registerTool(
    "ctx_verify",
    {
      description:
        `After AI edits: compare the project to the stored case file. ` +
        `Returns a plain report: same / changed / untested. ` +
        `Show that report unchanged. Do not claim business logic still matches unless the verdict is same. ` +
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
        const { caseFile, report } = await verifyCase(root);
        return {
          content: [{ type: "text" as const, text: formatVerifyReport(report, caseFile) }],
        };
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
    },
  );
}
