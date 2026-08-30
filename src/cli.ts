#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "./commands/scan.js";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runCapture } from "./commands/capture.js";
import { runVerify } from "./commands/verify.js";
import { runBrief } from "./commands/brief.js";
import { CtxError } from "./store/state.js";

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function handle(err: unknown): void {
  if (err instanceof CtxError) {
    process.stderr.write(`[ctx error] ${err.message}\n`);
    process.exit(2);
  }
  throw err;
}

program
  .name("ctx")
  .description("Capture → gate → verify → handoff for AI-assisted modernization")
  .version("0.1.0");

const engine = program.command("engine").description("Start/stop the ctx engine (this clone)");

engine.command("start").description("Turn the engine on").action(async () => {
  try {
    const { runEngineStart } = await import("./commands/engine.js");
    await runEngineStart();
  } catch (err) {
    handle(err);
  }
});

engine.command("stop").description("Turn the engine off — no scan/check/on/MCP").action(async () => {
  try {
    const { runEngineStop } = await import("./commands/engine.js");
    await runEngineStop();
  } catch (err) {
    handle(err);
  }
});

engine.command("status").description("Show whether the engine is running and which repos are linked").action(async () => {
  try {
    const { runEngineStatus } = await import("./commands/engine.js");
    await runEngineStatus();
  } catch (err) {
    handle(err);
  }
});

program
  .command("connect")
  .description("Link a work-repo path to this engine")
  .argument("<path>", "Path to the project you will modernize")
  .action(async (projectPath) => {
    try {
      const { runConnect } = await import("./commands/engine.js");
      await runConnect(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("unlink")
  .description("Unlink a work-repo path from this engine")
  .argument("[path]", "Path to unlink", ".")
  .action(async (projectPath) => {
    try {
      const { runUnlink } = await import("./commands/engine.js");
      await runUnlink(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("scan")
  .description("Scan a project and write dependency/platform state to .ctx/state.json")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      await runScan(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("init")
  .description("Enable ctx in this repo: write project configs and opt in")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      await runInit(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("on")
  .description("Enable ctx in this repo (same as init)")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      const { runOn } = await import("./commands/init.js");
      await runOn(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("off")
  .description("Disable ctx in this repo: remove AI wiring. Keeps recorded truth unless --purge")
  .argument("[path]", "Path to the project root", ".")
  .option("--purge", "Also delete .ctx/state.json, case file, and cache")
  .action(async (projectPath, opts) => {
    try {
      const { runOff } = await import("./commands/off.js");
      await runOff(projectPath, { purge: Boolean(opts.purge) });
    } catch (err) {
      handle(err);
    }
  });

program
  .command("remove")
  .alias("kill")
  .description("Kill switch: delete every ctx file, leftover instruction, user-level attach, and gate memory")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      const { runRemove } = await import("./commands/remove.js");
      await runRemove(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("disconnect")
  .description("Remove ctx from this machine's user-level Cursor/Claude config so no other repo sees it")
  .action(async () => {
    try {
      const { runDisconnect } = await import("./commands/disconnect.js");
      await runDisconnect();
    } catch (err) {
      handle(err);
    }
  });

program
  .command("doctor")
  .description("Report what this machine has, what is missing, and what to install — no writes")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      const { runDoctor } = await import("./commands/init.js");
      await runDoctor(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("capture")
  .description("Write the case file: decisions, edges, and a logic baseline")
  .argument("[path]", "Path to the project root", ".")
  .option("--decision <text>", "A confirmed fact (repeatable)", collect, [] as string[])
  .option("--edge <text>", "A known edge case that must not be skipped (repeatable)", collect, [] as string[])
  .option("--rule <text>", "A business rule that must still hold (repeatable)", collect, [] as string[])
  .option("--contract <text>", "A data contract that must still hold (repeatable)", collect, [] as string[])
  .option("--lock <text>", "A locked decision: modernizing this would break the system (repeatable)", collect, [] as string[])
  .option("--by <name>", "Who confirmed the extra facts", "human")
  .option("--replace", "Replace previously recorded human facts")
  .action(async (projectPath, opts) => {
    try {
      await runCapture(projectPath, opts);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("check")
  .description("Check compatibility of the scanned project against a target version")
  .argument("[path]", "Path to the project root", ".")
  .option("--target <spec>", "Target spec e.g. java=11 or node=20", "")
  .option("--report", "Write a Markdown report to ctx-report.md")
  .option("--report-path <file>", "Custom report output path")
  .action(async (projectPath, opts) => {
    try {
      await runCheck(projectPath, opts);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("verify")
  .description("After edits: compare the project to the stored case file")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      await runVerify(projectPath);
    } catch (err) {
      handle(err);
    }
  });

program
  .command("brief")
  .description("Short local summary from the case file (handoff; saves tokens)")
  .argument("[path]", "Path to the project root", ".")
  .action(async (projectPath) => {
    try {
      await runBrief(projectPath);
    } catch (err) {
      handle(err);
    }
  });

await program.parseAsync(process.argv);
