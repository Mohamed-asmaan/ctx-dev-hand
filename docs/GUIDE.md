# ctx guide — commands and manual

The assistant talks. ctx holds the facts.

This file is the **complete operator manual**. Clone, start, connect, scan, capture, check, verify, brief. Chat paste-prompts are not in git.

---

## What this repo is

This clone is the **engine**. Your application stays in its own folder. You never copy the app into this repo.

Two switches must both be on before scan / capture / check / verify / brief / MCP / `on`:

1. Engine running (`npm start` in this clone)
2. Work repo enabled (`ctx on` in that app)

If the engine is off, nothing runs.

---

## Paths (this machine)

| Role | Path |
| --- | --- |
| Engine | `D:\CTX-Dev-Hand` |
| Work app (Acme Inventory Desk) | `D:\cytx text repo\python-legacy` |
| Facts file | `D:\cytx text repo\python-legacy\.ctx\case.json` |
| CLI | `node D:\CTX-Dev-Hand\dist\cli.js` |

Always use **this** CLI. A bare `ctx` on PATH may be a different tool (for example a Maven-only scanner).

IBM Bob / Cursor MCP: every tool needs `repoRoot` = the **app** path, never the engine folder.

---

## Install and start

Requires Node.js 18+.

```text
cd D:\CTX-Dev-Hand
npm install
npm start
node dist/cli.js connect "D:\cytx text repo\python-legacy"
```

```text
cd "D:\cytx text repo\python-legacy"
node D:\CTX-Dev-Hand\dist\cli.js on .
```

Reload the editor. Approve the **ctx** MCP server. Open a **new** chat.

Generic (any machine):

```bash
git clone https://github.com/Mohamed-asmaan/ctx-dev-hand.git
cd ctx-dev-hand
npm install
npm start
node dist/cli.js connect "/absolute/path/to/your-app"
```

In the app:

```bash
node /absolute/path/to/ctx-dev-hand/dist/cli.js on .
```

---

## The loop

1. `scan` — inventory from the real build file → `.ctx/state.json`
2. A **person** confirms extra facts
3. `capture` — writes `.ctx/case.json` (scan facts + decisions + **locks** + edges)
4. `show` — print that file (path, locks, edges)
5. If someone says modernize: `check` — **wait**. Do not edit yet. Infrastructure is never auto-applied.
6. After confirmed edits: `verify` — same / changed / untested
7. Handoff: `brief`

Scan inventory is not a lock. `capture` with no `--lock` / `--edge` only stores libraries. A later modernize check will not stop until a person records locks.

---

## Command reference

Run from anywhere as `node D:\CTX-Dev-Hand\dist\cli.js <command>` (after `npm install` / `npm run build`).

| Command | Purpose |
| --- | --- |
| `engine start` / `npm start` | Turn the engine on |
| `engine stop` / `npm stop` | Turn the engine off — no operations |
| `engine status` | Running or off, and which paths are linked |
| `connect <path>` | Link a work repo (directory must exist) |
| `unlink [path]` | Drop a path from the engine list |
| `on` / `init` | Enable ctx in that repo |
| `off [--purge]` | Disable this repo; keep truth unless `--purge` |
| `remove` (`kill`) | Delete every ctx file and leftover wiring |
| `disconnect` | Strip ctx from **user-level** editor config |
| `doctor` | Report only — no writes |
| `scan` | Write `.ctx/state.json` |
| `capture` | Write `.ctx/case.json` |
| `show` (`facts`) | Print case file: path, locks, edges |
| `check --target <spec>` | Compatibility / decision report |
| `verify` | Compare tree to case file |
| `brief` | Short handoff |

### Capture

```text
node D:\CTX-Dev-Hand\dist\cli.js capture .
node D:\CTX-Dev-Hand\dist\cli.js capture . --lock "..." --edge "..." --decision "..." --rule "..." --contract "..."
node D:\CTX-Dev-Hand\dist\cli.js capture . --replace --by "human"
```

| Flag | Meaning |
| --- | --- |
| `--decision <text>` | Confirmed fact (repeatable) |
| `--edge <text>` | Edge that must not be skipped (repeatable) |
| `--rule <text>` | Business rule that must still hold (repeatable) |
| `--contract <text>` | Data contract that must still hold (repeatable) |
| `--lock <text>` | Locked decision: modernize **check is blocked** (repeatable) |
| `--by <name>` | Who confirmed |
| `--replace` | Replace previously recorded human facts (scan facts stay) |

### Check

```text
node D:\CTX-Dev-Hand\dist\cli.js check . --target python=3.12
node D:\CTX-Dev-Hand\dist\cli.js check . --target java=11
node D:\CTX-Dev-Hand\dist\cli.js check . --target architecture=microservices
```

If you omit `--target`, ctx may pick an adapter default (not from the model). Locked facts make the report **STOPPED**. Show the report unchanged. Wait.

### Everyday app commands

```text
cd "D:\cytx text repo\python-legacy"
node D:\CTX-Dev-Hand\dist\cli.js scan .
node D:\CTX-Dev-Hand\dist\cli.js capture .
node D:\CTX-Dev-Hand\dist\cli.js show .
node D:\CTX-Dev-Hand\dist\cli.js check . --target python=3.12
node D:\CTX-Dev-Hand\dist\cli.js verify .
node D:\CTX-Dev-Hand\dist\cli.js brief .
```

---

## MCP tools (IBM Bob / Cursor)

After `on`, the work repo’s `.cursor/mcp.json` and `.mcp.json` point at `D:/CTX-Dev-Hand/dist/mcp-cli.js`.

Pass **`repoRoot`** on every call — the open app, never this engine folder.

| Tool | When |
| --- | --- |
| `ctx_project_state` | First, always |
| `ctx_show` | Read decisions, locks, path to `case.json` |
| `ctx_capture` | After a **person** confirms; `locks` / `edges` / `decisions` |
| `ctx_check_change` | Any modernize / upgrade / “just fix” |
| `ctx_upgrade_plan` | Declared deps: forced / optional / current |
| `ctx_verify` | After edits: same / changed / untested |
| `ctx_verify_step` | Whether `upgradeOrder` step N is unblocked |
| `ctx_brief` | Handoff from the case file |

Tools return only facts in the response. They do not call an LLM. Do not invent versions from training memory.

---

## How the two eras work (manual, not chat scripts)

**Legacy-era developer:** this warehouse desk **is** current. Scan the real build file. A person records locks and edges (bind address, warehouse code order, hashing policy, flyer logins, sqlite vs postgres). Then a “modernize this” request must **stop** on those locks.

**Today’s developer:** do not recapture from scratch. Read `show` / `brief`. Use the old `case.json`. Check against a target. Locks still apply until a **person** unlocks a fact. After allowed edits, `verify`, then `brief`.

`ctx off` / `ctx remove` cannot wipe chat memory. Reload and start a **new** chat.

---

## Safety rules

- No Anthropic / OpenAI SDK. Compatibility data is local (`data/compatibility.json`) plus package registries.
- Never apply a step whose `kind` is `infrastructure`.
- If `compatibilityKnown` is false, say so. Do not fill the gap from memory.
- Engine off ⇒ E24. Path not connected ⇒ E25. Project off ⇒ E22. Missing `repoRoot` on MCP ⇒ E23.
- Registry TLS warnings mean this machine could not reach PyPI/Maven. Libraries are still recorded from the build file.

---

## Scripts

```bash
npm install          # also runs build (prepare)
npm run build
npm start            # engine start
npm stop             # engine stop
npm test
```

Hackathon security: see [SECURITY.md](../SECURITY.md). Copy `.env.example` to `.env` only if you add IBM Cloud calls. ctx itself does not need an API key.

---

## Layout

```text
src/adapters/     language-specific scan
src/compat/       check engine
src/case/         capture, compare, locks, verify
src/mcp/          MCP server and tools
src/commands/     CLI
data/             curated compatibility facts
samples/          small fixtures for tests
docs/GUIDE.md     this file
```
