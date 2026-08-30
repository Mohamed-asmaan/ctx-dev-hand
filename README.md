# ctx

**The assistant talks. ctx holds the facts.**

ctx is a local **fact engine** for AI-assisted software work. It sits beside any application repo, records what is actually true about that system, and refuses to let an AI guess versions, skip edge cases, or silently rewrite production behavior.

This repository is the **engine**. Your Flask app, Java service, or Node API stays in its own repo. You start ctx here, connect a path, turn ctx on in that project, then work.

Built for the **IBM Dev Day hackathon**.

Repository: [github.com/Mohamed-asmaan/ctx-dev-hand](https://github.com/Mohamed-asmaan/ctx-dev-hand)

Complete commands and operator manual: [docs/GUIDE.md](docs/GUIDE.md)

This repo follows the [IBM Hackathon GitHub Project Template](https://github.com/watsonxhackathon/ibm-hackathon-template): `.gitignore` security patterns, `.bobignore`, `.env.example`, and [SECURITY.md](SECURITY.md).

---

## IBM Hackathon security

**ctx does not need IBM Cloud credentials for the demo.** The engine is local. Do not paste API keys into Bob, Cursor, or git.

```bash
cp .env.example .env
# leave placeholders unless you add IBM Cloud calls yourself
git check-ignore -v .env
```

Before every commit:

- Reviewed `git diff` for sensitive data
- No hardcoded API keys or passwords
- `.env` is **not** staged
- No files named credential / secret / password
- Credentials live in environment variables only

If you add IBM Cloud or watsonx later, put keys in `.env` and read them with `process.env.IBM_CLOUD_API_KEY`. Never commit `.env`. Never remove patterns from `.gitignore` or `.bobignore`.

---

## Why this exists

AI coding assistants are fluent. They are not a source of truth.

On a real modernization or feature change they will:

- Invent library and runtime versions from training memory
- Skip warehouse-floor edge cases nobody wrote down
- “Upgrade while they are here” and break a system that still has to run
- Auto-apply infrastructure (databases, clusters, Terraform) as if it were a code edit

**IBM Bob (and every other assistant) should talk. ctx should hold the facts.**

ctx was built so a developer can:

1. Treat today’s code as the current product (including “legacy era” systems that are still the live desk)
2. **Record** decisions, edges, rules, and contracts in a case file
3. **Lock** facts that must not be broken (“thin clients hit this box by IP”)
4. **Gate** a later “modernize this” request: ctx checks first, names the failure risk, and waits
5. **Verify** after edits that the recorded baseline still matches
6. **Hand off** a short brief plus `.ctx/case.json` instead of a hallucinated architecture essay

If the engine is off, **no ctx operation runs**.

---

## What ctx can do

| Capability | What it means |
| --- | --- |
| Engine on / off | `npm start` / `npm stop` in this clone. Off = scan, check, capture, verify, brief, `on`, and MCP all refuse. |
| Connect a work repo | `ctx connect <path>` links the app you will actually change. A new app = connect that path. The app is never copied into this repo. |
| Project on / off | In the work repo, `ctx on` writes a short always-on rule and project MCP. `ctx off` deletes AI wiring so the model does not keep running the ctx loop. `ctx remove` is the kill switch. |
| Scan | Reads the real manifest (not model memory): language, runtime if declared, dependencies, imports, database hints. Writes `.ctx/state.json`. |
| Capture | Writes `.ctx/case.json`: scanned facts, human decisions, **locks**, edges, rules, contracts, and file hashes. A person confirms extra edges — ctx does not invent them. |
| Locked decisions | `--lock` / MCP `locks`. A later modernization **check is STOPPED**. Report says modernizing would cause system failure or behavior drift. Every recorded edge is listed. |
| Check | Compatibility / change report against a target (`python=3.12`, `java=11`, or a technology decision). Shows findings, `upgradeOrder`, blast radius, and the case-file gate. Never auto-applies `kind: infrastructure`. |
| Verify | After edits, compares the tree to the case file. Verdict: **same** / **changed** / **untested**. Show it unchanged. |
| Brief | ~10 line handoff from the case file. Do not re-explain the whole repo from memory. |
| Doctor | Machine + engine + connected paths. No writes. |
| MCP | Cursor (and other MCP clients) get `ctx_project_state`, `ctx_capture`, `ctx_check_change`, `ctx_upgrade_plan`, `ctx_verify`, `ctx_verify_step`, `ctx_brief`. Every tool requires `repoRoot`. Never defaults to the engine directory. |
| Gate hook | Optional editor hook: blocks file edits on an upgrade prompt until ctx has run and a person confirms. No-ops when ctx is off. |

### Stacks scan understands

Java / Maven, Python / pip, Node / npm, Go, Rust, PHP, Ruby, .NET, plus a generic marker adapter (Gradle, Mix, SwiftPM, and others).

Detection follows the **work repo’s** files (`requirements.txt`, `pom.xml`, `package.json`, …). Always run **this** engine’s CLI, not some other `ctx` on PATH.

---

## Architecture

```text
┌─────────────────────────┐         connect <path>
│  ctx engine (this repo) │ ──────────────────────────►  your app repo
│  npm start / npm stop   │                              ctx on / off
│  .ctx/engine.json       │                              .ctx/state.json
└─────────────────────────┘                              .ctx/case.json
        MCP + CLI                                                │
        facts only, no model SDK                                 │
                                                                 ▼
                                                         editor rule exists = ON
                                                         rule deleted = OFF
```

- **This clone** is the engine. Clone it on any computer, install, start, connect paths.
- **Work repos** stay where they are. ctx does not absorb the application.
- **On/off is two switches:** engine running, and this project enabled. Both are required for scan / check / MCP.
- **Token-light on/off:** `on` writes one short always-apply rule. `off` deletes it. No leftover “if off, ignore ctx” essay that still loads every turn.

---

## Quick start

Requires **Node.js 18+**.

```bash
git clone https://github.com/Mohamed-asmaan/ctx-dev-hand.git
cd ctx-dev-hand
npm install
npm start
node dist/cli.js connect "/absolute/path/to/your-app"
```

In the app repo:

```bash
node /absolute/path/to/ctx-dev-hand/dist/cli.js on .
```

Reload that editor window, enable the **ctx** MCP server if asked, **open a new chat**.

Then the loop:

```bash
node /path/to/ctx-dev-hand/dist/cli.js scan .
node /path/to/ctx-dev-hand/dist/cli.js capture . --edge "Empty cart returns zero" --lock "Bind 0.0.0.0 for thin clients"
node /path/to/ctx-dev-hand/dist/cli.js check . --target python=3.12
# wait for a person to say yes — do not edit yet
node /path/to/ctx-dev-hand/dist/cli.js verify .
node /path/to/ctx-dev-hand/dist/cli.js brief .
```

Windows example (engine at `D:\CTX-Dev-Hand`, app at `D:\cytx text repo\python-legacy`):

```text
cd D:\CTX-Dev-Hand
npm install
npm start
node dist/cli.js connect "D:\cytx text repo\python-legacy"

cd "D:\cytx text repo\python-legacy"
node D:\CTX-Dev-Hand\dist\cli.js on .
node D:\CTX-Dev-Hand\dist\cli.js scan .
```

Do **not** type a bare `ctx scan` unless that `ctx` is this repo’s `dist/cli.js`. Another `ctx` on PATH may be a Java-only scanner and will fail on a Flask app.

---

## Command reference

Run via `node dist/cli.js <command>` from the engine clone (after `npm install` / `npm run build`).

| Command | Purpose |
| --- | --- |
| `engine start` / `npm start` | Turn the engine on |
| `engine stop` / `npm stop` | Turn the engine off — no operations |
| `engine status` | Running or off, and which paths are linked |
| `connect <path>` | Link a work repo (directory must exist) |
| `unlink [path]` | Drop a path from the engine list |
| `on` / `init` | Enable ctx in that repo (requires engine running + connected) |
| `off [--purge]` | Disable this repo; keep truth unless `--purge` |
| `remove` (`kill`) | Delete every ctx file, leftover instructions, user-level attach, gate temp |
| `disconnect` | Strip ctx from **user-level** Cursor/Claude config so it does not follow other repos |
| `doctor` | Report only |
| `scan` | Write `.ctx/state.json` |
| `capture` | Write `.ctx/case.json` |
| `check --target <spec>` | Compatibility / decision report |
| `verify` | Compare tree to case file |
| `show` (`facts`) | Print the case file: path, locks, edges |
| `brief` | Short handoff |

### Capture flags

```text
--decision <text>   Confirmed fact (repeatable)
--edge <text>       Edge that must not be skipped (repeatable)
--rule <text>       Business rule that must still hold (repeatable)
--contract <text>   Data contract that must still hold (repeatable)
--lock <text>       Locked decision: modernize check is blocked (repeatable)
--by <name>         Who confirmed
--replace           Replace previously recorded human facts
```

### Check targets

```text
--target java=11
--target python=3.12
--target architecture=microservices
```

If you omit `--target`, ctx may pick a default from the adapter (not from the model).

---

## MCP tools

After `ctx on`, the work repo’s `.cursor/mcp.json` points at `dist/mcp-cli.js` in **this** clone.

Pass **`repoRoot`** on every call — the path of the open app, never the engine folder.

| Tool | Role |
| --- | --- |
| `ctx_project_state` | Inventory + case-file status |
| `ctx_capture` | Record decisions, edges, rules, contracts, **locks** |
| `ctx_show` | Print `.ctx/case.json`: locks, edges, where decisions live |
| `ctx_check_change` | Proposed upgrade or technology decision |
| `ctx_upgrade_plan` | Declared deps classified forced / optional / current |
| `ctx_verify` | After edits: same / changed / untested |
| `ctx_verify_step` | Whether `upgradeOrder` step N is unblocked |
| `ctx_brief` | Handoff text from the case file |

Tools return only facts in the response. They do not call an LLM.

---

## The required loop (when ctx is on)

1. `ctx_project_state`
2. If no case file: `scan` then `ctx_capture` (person confirms extra edges — do not invent them)
3. For a stack/modernize request: `ctx_check_change`. Show findings + `upgradeOrder` + locks + edges **unchanged**. **Wait.**
4. Never apply a step whose `kind` is `infrastructure`
5. After confirmed edits: `ctx_verify`
6. Handoff: `ctx_brief`

If the user is **not** modernizing — they are adding a feature in the current era — skip check unless they ask to change the stack. Still capture and verify.

If ctx returns engine off, not connected, or not enabled: **stop** and print the exact command. Do not continue without ctx.

---

## Safety rules baked in

- No Anthropic / OpenAI SDK. Compatibility data is local (`data/compatibility.json`) plus package registries.
- Infrastructure steps are never auto-applied.
- If `compatibilityKnown` is false, ctx says so. The model must not fill the gap.
- Engine off ⇒ E24. Path not connected ⇒ E25. Project off ⇒ E22. Missing `repoRoot` on MCP ⇒ E23.
- `ctx off` / `ctx remove` cannot wipe **chat** memory. Reload the window and start a **new** chat.

---

## Project layout

```text
src/adapters/     language-specific scan (Java, Python, Node, …)
src/compat/       check engine (findings, upgrade order)
src/case/         capture, compare, locks, verify reports
src/mcp/          MCP server and tools
src/commands/     CLI: engine, on/off, scan, capture, check, …
data/             curated compatibility facts
samples/          small legacy fixtures for tests
scripts/ctx-gate.cjs   editor gate hook
```

---

## Scripts

```bash
npm install          # also runs build (prepare)
npm run build
npm start            # engine start
npm stop             # engine stop
npm test
npm run test:coverage
```

---

## IBM Dev Day

This project was built for **IBM Dev Day** as a working answer to a problem IBM-style assistants hit in the real world: they can generate code all day, but they cannot be the system of record for a warehouse desk, a Java 8 service, or a locked production constraint.

**ctx** is that system of record — local, inspectable, opt-in per repo, killable in one command, and honest when it does not know.

---

## License

MIT. See `package.json`.
