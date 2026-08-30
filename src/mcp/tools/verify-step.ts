import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readState, CtxError } from "../../store/state.js";
import { evaluateChange } from "../../compat/evaluate.js";
import type { FindingsResult, UpgradeStep } from "../../store/schema.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

export interface StepVerification {
  stepNumber: number;
  action: string;
  kind: UpgradeStep["kind"];
  blockedBy: string[];
  satisfied: boolean;
  remainingBlockers: string[];
  stepStillNeeded: boolean;
  compatibilityKnown: true;
}

export function evaluateUpgradeStep(
  result: FindingsResult,
  stepNumber: number,
): { error: string } | StepVerification {
  const step = result.upgradeOrder.find((s) => s.step === stepNumber);
  if (!step) {
    return { error: `step ${stepNumber} not in upgradeOrder` };
  }

  const blockerNums = step.blockedBy
    .map((b) => parseInt(b.replace(/[^\d]/g, ""), 10))
    .filter((n) => n > 0);
  const remainingBlockers = blockerNums.filter((n) =>
    result.upgradeOrder.some((s) => s.step === n && s.resolves.length > 0),
  );

  return {
    stepNumber: step.step,
    action: step.action,
    kind: step.kind,
    blockedBy: step.blockedBy,
    satisfied: remainingBlockers.length === 0,
    remainingBlockers: remainingBlockers.map((n) => `step ${n}`),
    stepStillNeeded: step.resolves.length > 0 || step.kind === "config",
    compatibilityKnown: true,
  };
}

export function registerVerifyStepTool(server: McpServer): void {
  server.registerTool(
    "ctx_verify_step",
    {
      description:
        `Returns whether upgradeOrder stepNumber's preconditions are now satisfied. ` +
        `A step is ready only when every blockedBy step is resolved (its findings no longer appear). ` +
        `${MANDATORY_WORKFLOW} ${GROUNDING_INSTRUCTION}`,
      inputSchema: z.object({
        stepNumber: z.number().describe("1-based step number from upgradeOrder"),
        target: z.object({
          language: z.string().optional(),
          version: z.string().optional(),
          spec: z.string().optional(),
        }).optional(),
        repoRoot: z
          .string()
          .describe("Path to the open project root. Required. Never omit this or use the ctx engine directory."),
      }),
    },
    async (input) => {
      let root: string;
      try {
        root = await requireWorkspace(input.repoRoot);
      } catch (err) {
        const mcp = asMcpError(err);
        if (mcp) return mcp;
        throw err;
      }
      let state;
      try {
        state = await readState(root);
      } catch (err) {
        if (err instanceof CtxError && err.code === "E16") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "E16", message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }

      const spec = input.target?.spec;
      const value = input.target?.version ?? state.declaredRuntimeVersion;
      if (!spec && !value) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "target.version or target.spec is required" }) }],
          isError: true,
        };
      }
      const parsed = spec
        ? { key: spec.split(/[=:]/)[0] ?? state.language, value: spec.split(/[=:]/).slice(1).join("=") || value || "" }
        : { key: (input.target?.language ?? state.language).toLowerCase(), value: value! };

      const result = await evaluateChange(root, parsed);
      const verification = evaluateUpgradeStep(result, input.stepNumber);
      if ("error" in verification) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: verification.error, compatibilityKnown: true }) }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(verification, null, 2),
        }],
      };
    },
  );
}
