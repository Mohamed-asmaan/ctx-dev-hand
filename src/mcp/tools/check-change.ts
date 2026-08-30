import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readState } from "../../store/state.js";
import { readCaseOptional } from "../../store/case.js";
import { evaluateChange } from "../../compat/evaluate.js";
import { parseTarget, type ParsedTarget } from "../../compat/target.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW, CHECK_CHANGE_ORDER_RULES } from "../grounding.js";
import { formatPlainReport } from "../../output/plain.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export function registerCheckChangeTool(server: McpServer): void {
  server.registerTool(
    "ctx_check_change",
    {
      description:
        `Checks a proposed upgrade and returns a plain-language report including recorded case-file edges. ` +
        `Show that report to the user unchanged — do not rewrite it as a schema or field table. ` +
        `${MANDATORY_WORKFLOW} ` +
        `${CHECK_CHANGE_ORDER_RULES} ` +
        `${GROUNDING_INSTRUCTION}`,
      inputSchema: z.object({
        target: z.object({
          language: z.string().optional().describe("Target language or decision domain, e.g. 'java' or 'architecture'"),
          version: z.string().optional().describe("Target version or decision value, e.g. '11' or 'microservices'"),
          spec: z.string().optional().describe("Alternate form: 'java=11' or 'architecture=microservices'"),
        }).describe("The proposed change to check against the declared project state"),
        repoRoot: z
          .string()
          .describe("Path to the open project root. Required. Never omit this or use the ctx engine directory."),
      }),
    },
    async (input) => {
      try {
        const root = await requireWorkspace(input.repoRoot);

        const state = await readState(root);

        let parsed: ParsedTarget | null = null;
        if (input.target.spec) {
          parsed = parseTarget(input.target.spec);
        } else if (input.target.version) {
          parsed = {
            key: (input.target.language ?? state.language).toLowerCase(),
            value: input.target.version,
          };
        }

        if (!parsed) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "target.version or target.spec is required" }) }],
            isError: true,
          };
        }

        const result = await evaluateChange(root, parsed);
        const caseFile = await readCaseOptional(root);
        return {
          content: [{
            type: "text" as const,
            text: formatPlainReport(result, state, `${parsed.key}=${parsed.value}`, caseFile),
          }],
        };
      } catch (err: unknown) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        if (err instanceof Error && err.message.startsWith("E20")) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "E20", message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
