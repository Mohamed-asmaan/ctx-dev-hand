import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatShow } from "../../commands/show.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";
import { readCaseOptional } from "../../store/case.js";
import { CtxError } from "../../store/state.js";

export function registerShowTool(server: McpServer): void {
  server.registerTool(
    "ctx_show",
    {
      description:
        `Prints developer decisions, locks, and edges from .ctx/case.json. ` +
        `IBM Bob: call this to read facts. Do not invent them from chat memory. ` +
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
        const file = path.join(root, ".ctx", "case.json");
        const caseFile = await readCaseOptional(root);
        if (!caseFile) {
          throw new CtxError(
            "E21",
            `No case file at ${file}. Run ctx scan then ctx_capture. A person confirms extra facts — do not invent them.`,
          );
        }
        return {
          content: [{ type: "text" as const, text: formatShow(caseFile, file) }],
        };
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
    },
  );
}
