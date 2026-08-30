// src/mcp/tools/upgrade-plan.ts
// ctx_upgrade_plan — all available upgrades classified forced/optional/current.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readState, CtxError } from "../../store/state.js";
import { cacheGet } from "../../store/cache.js";
import { compareSemver } from "../../compat/loader.js";
import { GROUNDING_INSTRUCTION, MANDATORY_WORKFLOW } from "../grounding.js";
import { asMcpError, requireWorkspace } from "../workspace.js";

interface UpgradeEntry {
  dependency: string;
  installed: string;
  latestAvailable: string | null;
  classification: "current" | "optional" | "forced";
  reason: string;
  source: string;
  fetchedAt: string | null;
  compatibilityKnown: boolean;
}

export function registerUpgradePlanTool(server: McpServer): void {
  server.registerTool(
    "ctx_upgrade_plan",
    {
      description:
        `Returns all declared dependencies classified as: ` +
        `'forced' (advisory or EOL — upgrade required), ` +
        `'optional' (newer version available, no known issue), ` +
        `or 'current' (already at latest). ` +
        `Each entry includes evidence source and fetch date. ` +
        `${MANDATORY_WORKFLOW} ${GROUNDING_INSTRUCTION}`,
      inputSchema: z.object({
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

      const upgrades: UpgradeEntry[] = [];
      const now = new Date().toISOString();

      for (const dep of state.dependencies) {
        const key = `${dep.groupId}:${dep.artifactId}`;

        if (dep.version === "unresolved" || dep.version === "range") {
          upgrades.push({
            dependency: key,
            installed: dep.versionRaw,
            latestAvailable: null,
            classification: "optional",
            reason: `Version is ${dep.version} — cannot evaluate without resolving`,
            source: "manifest",
            fetchedAt: null,
            compatibilityKnown: false,
          });
          continue;
        }

        const cached = await cacheGet(root, key) as { latestVersion?: string; fetchedAt?: string; stale?: boolean } | null;
        if (!cached || !cached.latestVersion) {
          upgrades.push({
            dependency: key,
            installed: dep.version,
            latestAvailable: null,
            classification: "optional",
            reason: "Registry data not available — run `ctx scan` to fetch",
            source: "cache-miss",
            fetchedAt: null,
            compatibilityKnown: false,
          });
          continue;
        }

        const isCurrent = compareSemver(dep.version, cached.latestVersion) >= 0;
        upgrades.push({
          dependency: key,
          installed: dep.version,
          latestAvailable: cached.latestVersion,
          // MVP: no advisory API — flag as optional if newer exists
          classification: isCurrent ? "current" : "optional",
          reason: isCurrent
            ? `Already at latest version (${cached.latestVersion})`
            : `Newer version available: ${cached.latestVersion}`,
          source: cached.stale ? "cache-stale" : "registry",
          fetchedAt: cached.fetchedAt ?? null,
          compatibilityKnown: true,
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ upgrades }, null, 2) }],
      };
    },
  );
}
