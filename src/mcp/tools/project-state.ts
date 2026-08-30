import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readState, CtxError } from "../../store/state.js";
import { readCaseOptional } from "../../store/case.js";
import { formatPlainState } from "../../output/plain.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export function registerProjectStateTool(server: McpServer): void {
  server.registerTool(
    "ctx_project_state",
    {
      description:
        `Returns the project's declared platform and dependency inventory, plus case-file status. ` +
        `Use this before ctx_check_change. If there is no case file, call ctx_capture next. ` +
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
        const state = await readState(root);
        const caseFile = await readCaseOptional(root);
        return {
          content: [{ type: "text" as const, text: formatPlainState(state, caseFile) }],
        };
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
    },
  );
}
