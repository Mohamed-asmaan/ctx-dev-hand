import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureCase } from "../../commands/capture.js";
import { formatCaptureSummary } from "../../case/report.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export function registerCaptureTool(server: McpServer): void {
  server.registerTool(
    "ctx_capture",
    {
      description:
        `Writes the case file (.ctx/case.json): recorded decisions, edges, ` +
        `and a logic baseline (file hashes, libraries, runtime). ` +
        `IBM Bob must call this after scan if there is no case file. ` +
        `A person must confirm extra edges — do not invent them. ` +
        `${MANDATORY_WORKFLOW} ${GROUNDING_INSTRUCTION}`,
      inputSchema: z.object({
        repoRoot: z
          .string()
          .describe("Path to the open project root. Required. Never omit this or use the ctx engine directory."),
        decisions: z.array(z.string()).optional().describe("Confirmed facts from a person."),
        edges: z.array(z.string()).optional().describe("Known edge cases that must not be skipped."),
        rules: z.array(z.string()).optional().describe("Business rules that must still hold."),
        contracts: z.array(z.string()).optional().describe("Data contracts that must still hold."),
        locks: z
          .array(z.string())
          .optional()
          .describe("Locked decisions. A later modernize check is blocked; changing these risks system failure."),
        by: z.string().optional().describe("Who confirmed the extra facts."),
        replace: z.boolean().optional().describe("Replace previously recorded human facts."),
      }),
    },
    async (input) => {
      try {
        const root = await requireWorkspace(input.repoRoot);
        const caseFile = await captureCase(root, {
          decisions: input.decisions,
          edges: input.edges,
          rules: input.rules,
          contracts: input.contracts,
          locks: input.locks,
          by: input.by,
          replace: input.replace,
        });
        return {
          content: [{ type: "text" as const, text: formatCaptureSummary(caseFile) }],
        };
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
    },
  );
}
