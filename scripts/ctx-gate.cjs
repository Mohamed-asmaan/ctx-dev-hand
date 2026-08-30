#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function workspaceRoot(input) {
  if (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) {
    return String(input.workspace_roots[0]);
  }
  return (
    input.cwd ||
    input.workspaceRoot ||
    process.cwd()
  );
}

function normalizeRepoPath(p) {
  let abs = path.resolve(p).replace(/\\/g, "/");
  if (abs.length > 1 && abs.endsWith("/")) abs = abs.slice(0, -1);
  if (process.platform === "win32") abs = abs.toLowerCase();
  return abs;
}

function isCtxEnabled(input) {
  const root = workspaceRoot(input);
  const file = path.join(root, ".ctx", "config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    return cfg && cfg.enabled === true;
  } catch {
    return false;
  }
}

function engineFileFor(root) {
  if (process.env.CTX_ENGINE_FILE) return process.env.CTX_ENGINE_FILE;
  try {
    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".cursor", "mcp.json"), "utf8"));
    const mcpCli = mcp && mcp.mcpServers && mcp.mcpServers.ctx && mcp.mcpServers.ctx.args
      ? mcp.mcpServers.ctx.args[0]
      : null;
    if (!mcpCli) return null;
    const abs = path.isAbsolute(mcpCli) ? mcpCli : path.join(root, mcpCli);
    return path.join(path.dirname(path.dirname(abs)), ".ctx", "engine.json");
  } catch {
    return null;
  }
}

function readEngine(root) {
  const file = engineFileFor(root);
  if (!file) return { running: false, connected: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      running: parsed && parsed.running === true,
      connected: Array.isArray(parsed.connected) ? parsed.connected : [],
    };
  } catch {
    return { running: false, connected: [] };
  }
}

function isEngineLinked(input) {
  const root = workspaceRoot(input);
  const engine = readEngine(root);
  if (!engine.running) return false;
  const key = normalizeRepoPath(root);
  return engine.connected.map((c) => normalizeRepoPath(String(c))).includes(key);
}

function isCtxLive(input) {
  return isCtxEnabled(input) && isEngineLinked(input);
}

function projectKey(input) {
  const cwd = workspaceRoot(input);
  return `project-${String(cwd).replace(/[^A-Za-z0-9]+/g, "_").slice(-80)}`;
}

function gateFile(key) {
  const dir = path.join(os.tmpdir(), "ctx-upgrade-gate");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}.json`);
}

function convId(input) {
  return input.conversation_id || input.session_id || "unknown";
}

function gateKeys(input) {
  return [convId(input), projectKey(input)];
}

function loadGate(input) {
  const rank = { idle: 0, required: 1, checked: 2, confirmed: 3 };
  let best = { status: "idle" };
  for (const key of gateKeys(input)) {
    try {
      const data = JSON.parse(fs.readFileSync(gateFile(key), "utf8"));
      if ((rank[data.status] ?? 0) > (rank[best.status] ?? 0)) best = data;
    } catch {
      /* miss */
    }
  }
  return best;
}

function saveGate(input, data) {
  const payload = JSON.stringify(data);
  for (const key of gateKeys(input)) {
    fs.writeFileSync(gateFile(key), payload);
  }
}

const UPGRADE_RE =
  /\b(upgrade|migrat|moderniz|convert|port|rewrite|replatform|refactor)\b|\b(microservice|monolith|kubernetes|k8s|terraform|docker|helm)\b.{0,40}\b(to|into|from|adopt|move)\b|(\bto\b|\binto\b|->|→).{0,40}\b(java|jdk|node|python|go|golang|rust|php|ruby|dotnet|django|flask|spring|express|rails|laravel)\b|(\bjava\b|\bnode\b|\bpython\b|\bgo\b|\brust\b|\bphp\b|\bruby\b).{0,80}(\bto\b|\binto\b|->|→)/i;

const CONFIRM_RE = /^(yes|y|ok|okay|confirm|confirmed|proceed|go ahead|do it|apply|approved|lgtm)\b/i;

const EDIT_TOOLS = new Set([
  "Write",
  "StrReplace",
  "EditNotebook",
  "Delete",
  "Edit",
  "MultiEdit",
]);

const INFRA_SHELL =
  /\b(terraform\s+apply|kubectl\s+apply|helm\s+install|docker\s+compose|ansible-playbook)\b/i;

const CTX_CHECK_RE = /\bctx(_check_change|\s+check)\b/;

const ENGINE_OFF_LINE = "ctx OFF. Engine is stopped. Do not call ctx. Work normally.";

function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function denyEdit(waitingForCtx) {
  const reason = waitingForCtx
    ? "Edit blocked. Call ctx_project_state then ctx_check_change now (or ctx scan / ctx check). Report findings and the upgradeOrder. Do not edit. Wait for the user to confirm."
    : "Edit blocked. ctx already ran. Show the findings and upgradeOrder, then WAIT. Only edit after the user confirms (yes / proceed / confirm). Never auto-apply infrastructure.";
  reply({
    permission: "deny",
    decision: "block",
    reason,
    user_message: waitingForCtx
      ? "ctx gate: the AI must call ctx before editing."
      : "ctx gate: waiting for your confirmation before any edits.",
    agent_message: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

async function main() {
  const input = await readStdin();
  const event = String(input.hook_event_name || "");

  if (!isCtxLive(input)) {
    const enabledButEngineOff =
      isCtxEnabled(input) &&
      (event === "sessionStart" || event === "SessionStart");
    if (event === "preToolUse" || event === "PreToolUse") {
      reply({
        permission: "allow",
        decision: "approve",
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      });
      return;
    }
    if (enabledButEngineOff) {
      reply({ continue: true, additional_context: ENGINE_OFF_LINE });
      return;
    }
    reply({ continue: true });
    return;
  }

  if (event === "sessionStart" || event === "SessionStart") {
    reply({ continue: true });
    return;
  }

  if (event === "beforeSubmitPrompt" || event === "UserPromptSubmit") {
    const prompt = String(input.prompt || input.user_prompt || "");
    const gate = loadGate(input);
    if (UPGRADE_RE.test(prompt)) {
      saveGate(input, { status: "required", at: new Date().toISOString() });
      reply({ continue: true });
      return;
    }
    if (CONFIRM_RE.test(prompt.trim()) && gate.status === "checked") {
      saveGate(input, { ...gate, status: "confirmed" });
    }
    reply({ continue: true });
    return;
  }

  if (
    event === "afterMCPExecution" ||
    event === "PostToolUse" ||
    event === "afterToolUse"
  ) {
    const name = String(input.tool_name || "");
    const cmd = String(input.tool_input?.command || input.command || "");
    if (/ctx_check_change/.test(name) || CTX_CHECK_RE.test(cmd)) {
      const gate = loadGate(input);
      if (gate.status === "required" || gate.status === "idle") {
        saveGate(input, { ...gate, status: "checked" });
      }
    }
    reply({});
    return;
  }

  if (event === "preToolUse" || event === "PreToolUse") {
    const tool = String(input.tool_name || "");
    const cmd = String(input.tool_input?.command || input.command || "");
    const gate = loadGate(input);
    const locked = gate.status === "required" || gate.status === "checked";
    if (!locked) {
      reply({
        permission: "allow",
        decision: "approve",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      });
      return;
    }

    if (EDIT_TOOLS.has(tool)) {
      denyEdit(gate.status === "required");
      return;
    }

    if ((tool === "Shell" || tool === "Bash") && INFRA_SHELL.test(cmd)) {
      denyEdit(gate.status === "required");
      return;
    }

    reply({
      permission: "allow",
      decision: "approve",
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    return;
  }

  if (event === "sessionEnd") {
    for (const key of gateKeys(input)) {
      try {
        fs.unlinkSync(gateFile(key));
      } catch {
        /* ignore */
      }
    }
    reply({});
    return;
  }

  reply({});
}

main().catch(() => {
  process.stdout.write("{}");
});
