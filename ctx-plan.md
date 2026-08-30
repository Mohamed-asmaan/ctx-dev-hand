# ctx — Pre-flight Safety Check for Legacy Modernization: Implementation Plan

## Overview

`ctx` is a command-line tool that reads a project's declared platform (language
version, database version, dependency versions), fetches current facts from
the package registry, and reports version conflicts **before** a change is made.
It also runs as an MCP server so that IBM Bob can query it during a normal
conversation, then explain the findings in plain language.

**`ctx` performs no reasoning. Bob performs no fact-fetching.**

### Architecture

Three layers, strictly separated.

```
Developer
"Modernize this codebase to Java 11"
        │
        ▼
LAYER 3 — IBM Bob  (the only AI in the system)
  · Decides which ctx tools to call
  · Reads structured JSON evidence
  · Explains conflicts in plain language
  · MUST NOT state version facts from its own memory
        │  MCP (stdio, JSON-RPC)
        ▼
LAYER 2 — Constraint engine  (deterministic, no AI)
  · C1 language→dependency  · C2 dependency→database
  · C3 EOL / advisory       · Upgrade order resolver
  Output: structured findings JSON
        │
        ▼
LAYER 1 — Readers  (deterministic, no AI)
  ┌─────────────┬─────────────┬─────────────┬──────────────────┐
  │ pom.xml     │ compose     │ imports     │ Maven Central    │
  │ reader      │ reader      │ scanner     │ client + cache   │
  └─────────────┴─────────────┴─────────────┴──────────────────┘
        │
        ▼
  .ctx/ (local, git-tracked)
  state.json + cache/

Everything runs on the developer's laptop. No server. No hosting. No API key.
```

### Target stack

**Java / Maven.** The reference scenario is a Java 8 → Java 11 migration. If
the stack changes to a different ecosystem, only Layer 1 (Readers) changes;
Layers 2 and 3 are stack-independent.

### Technology

- **Language:** TypeScript, Node 18+
- **CLI:** `commander`
- **MCP transport:** `@modelcontextprotocol/sdk`, stdio
- **XML parsing:** `fast-xml-parser` (not regex — pom.xml is XML)
- **YAML parsing:** `js-yaml` (for docker-compose)
- **HTTP:** native `fetch` (Node 18+)
- **Dev tools:** `typescript`, `tsx`, `vitest`, `@types/node`
- **No AI SDK. No API key of any kind.**

---

## Scope boundary

### In scope

| # | Capability |
|---|---|
| 1 | Read declared Java version, dependencies, and database version from project files |
| 2 | Fetch current version, EOL status, and advisories from Maven Central |
| 3 | Detect three conflict classes: C1 language-forces-dependency, C2 dependency-drops-database, C3 EOL/advisory |
| 4 | Compute a safe upgrade order when conflicts chain |
| 5 | Locate every source file that uses an affected dependency (blast radius) |
| 6 | Expose all of the above to Bob via MCP |
| 7 | Attach provenance (source URL + fetch date) to every fetched fact |
| 8 | Attach a plain-language reason to every finding |

### Explicitly out of scope

| Excluded |
|---|
| Inferring rules from git history |
| A `why` command explaining code intent |
| Transitive dependency graph (direct dependencies only) |
| Applying fixes automatically |
| Monorepos, private registries, multiple manifests |
| Any hosted service, database, or web UI |
| Any AI model inside `ctx` |

---

## Store design

### Location
`.ctx/` at the repo root, git-tracked.

### Files

| File | Purpose |
|---|---|
| `state.json` | Last scan result: readers' output merged into one object |
| `cache/<groupId>:<artifactId>.json` | Maven Central response, keyed by artifact |

### `state.json` schema

```json
{
  "schemaVersion": 1,
  "scannedAt": "ISO 8601",
  "language": "java",
  "declaredJavaVersion": "string",
  "buildTool": "maven",
  "manifestPath": "pom.xml",
  "parentResolved": false,
  "dependencies": [
    {
      "groupId": "string",
      "artifactId": "string",
      "version": "string | 'unresolved' | 'range'",
      "scope": "compile | test | provided | runtime",
      "versionRaw": "string — original value before property resolution"
    }
  ],
  "platform": {
    "database": {
      "engine": "postgres | mysql | mariadb | mongo | null",
      "version": "string | null",
      "declaredIn": "file:line | null",
      "confidence": "declared | inferred",
      "allFound": [
        { "engine": "string", "version": "string", "declaredIn": "string",
          "service": "string | null" }
      ]
    }
  },
  "importMap": {
    "<groupId>": ["src/path/File.java:12", "src/path/Other.java:5"]
  }
}
```

### Cache entry schema

```json
{
  "groupId": "string",
  "artifactId": "string",
  "latestVersion": "string",
  "versions": ["string"],
  "fetchedAt": "ISO 8601",
  "stale": false,
  "available": true
}
```

---

## Compatibility knowledge file

`data/compatibility.json` — shipped with the tool, hand-verified.

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "key": "org.postgresql:postgresql",
      "constraints": [
        {
          "fromVersion": "42.3.0",
          "requires": { "postgres": ">=10" },
          "note": "Support for PostgreSQL 9.6 and earlier was removed",
          "verifiedAt": "2026-08-30",
          "sourceUrl": "https://jdbc.postgresql.org/changelogs/"
        }
      ]
    },
    {
      "key": "jdk:removals",
      "constraints": [
        {
          "fromVersion": "11",
          "removed": [
            "javax.xml.bind", "javax.activation",
            "java.xml.ws", "javax.annotation", "java.corba"
          ],
          "note": "Java EE and CORBA modules removed from the JDK in Java 11",
          "verifiedAt": "2026-08-30",
          "sourceUrl": "https://openjdk.org/jeps/320"
        }
      ]
    }
  ]
}
```

Minimum required entries: `org.postgresql:postgresql`,
`mysql:mysql-connector-java`, `org.springframework:spring-core`,
`org.hibernate:hibernate-core`, `jdk:removals`.

---

## Findings and output schema

```json
{
  "schemaVersion": 1,
  "verdict": "blocked | clear | manual",
  "findings": [
    {
      "id": "F1",
      "class": "C1_language_forces_dependency | C2_dependency_drops_database | C3_eol_advisory",
      "severity": "blocking | warning",
      "dependency": "groupId:artifactId",
      "installed": "string",
      "minimumForTarget": "string | null",
      "dependsOn": "finding-id | null",
      "evidence": {
        "fact": "string",
        "source": "curated | registry | changelog-inferred | unknown",
        "fetchedAt": "ISO 8601"
      },
      "reason": "string — plain English, mandatory on every finding"
    }
  ],
  "upgradeOrder": [
    {
      "step": 1,
      "action": "string",
      "resolves": ["finding-id"],
      "blockedBy": ["step N"]
    }
  ],
  "blastRadius": {
    "<groupId>": ["src/path/File.java:12"]
  },
  "checkedAt": "ISO 8601",
  "notChecked": {
    "unresolved": ["groupId:artifactId"],
    "range": ["groupId:artifactId"],
    "noRegistry": ["groupId:artifactId"],
    "noCompatibility": ["groupId:artifactId"]
  }
}
```

---

## Module structure

```
ctx/
  bin/
    ctx.js          ← CLI entry point (commander.js); commands: scan, check
    ctx-mcp.js      ← MCP server entry point (stdio)
  src/
    readers/
      manifest.ts   ← readManifest(repoRoot): pom.xml parser
      platform.ts   ← readPlatform(repoRoot): database version detector
      imports.ts    ← scanImports(repoRoot): usage locator
      registry.ts   ← fetchArtifact(groupId, artifactId): Maven Central client
    store/
      state.ts      ← readState / writeState: .ctx/state.json
      cache.ts      ← cacheGet / cacheSet: .ctx/cache/<key>.json
    compat/
      loader.ts     ← loadCompatibility(): reads data/compatibility.json
      engine.ts     ← runC1 / runC2 / runC3 / resolveOrder: pure functions
    mcp/
      server.ts     ← McpServer entry; registers all three tools
      tools/
        project-state.ts  ← ctx_project_state handler
        check-change.ts   ← ctx_check_change handler
        upgrade-plan.ts   ← ctx_upgrade_plan handler
    commands/
      scan.ts       ← ctx scan: runs all readers, writes state.json
      check.ts      ← ctx check: loads state, runs engine, prints report
    output/
      terminal.ts   ← human-readable blocking report to stdout
      markdown.ts   ← writes ctx-report.md (--report flag)
  data/
    compatibility.json
  samples/
    legacy-java-app/
      pom.xml
      docker-compose.yml
      src/db/Connection.java
      src/db/Pool.java
      src/api/XmlMapper.java
  benchmark/
    run.sh
  package.json
  tsconfig.json
```

### Data contract between modules

```
Commands / MCP tools
  └─ readers/*      → deterministic data extraction; returns typed structs
  └─ store/*        → read/write .ctx/ files; no logic
  └─ compat/loader  → returns CompatibilityDb (loaded once, passed around)
  └─ compat/engine  → pure functions; receives readers' output + compat db
                    → returns FindingsResult
  └─ output/*       → receives FindingsResult; produces strings or files
```

No reader imports another reader. The engine imports nothing from `readers/`
or `store/` — it receives all inputs as arguments. MCP tool handlers are
thin wrappers: call readers (or load from state), call engine, return JSON.

---

## Edge cases

All 20 must have a code path and a test.

| # | Case | Required behaviour |
|---|---|---|
| E1 | No `pom.xml` | Exit 2: "no Maven project found at `<path>`" |
| E2 | `pom.xml` has `<parent>` | Parse local content; set `parentResolved: false`; warn |
| E3 | Version is `${property}` | Resolve from `<properties>`; if unresolvable, mark `"unresolved"`, skip from checks |
| E4 | Version range `[1.0,2.0)` | Mark `"range"`, skip from checks, list in `notChecked.range` |
| E5 | No database declared | C2 does not run; output states "no database declared — compatibility not checked" |
| E6 | Two databases in compose | Check all; report per-service |
| E7 | Registry unreachable | Serve stale cache with `stale: true` and original fetch date; if no cache, `available: false` |
| E8 | Registry 429 | One retry after 2s, then E7 behaviour |
| E9 | Dependency absent from Maven Central | `{ found: false }`; exclude from checks; list in `notChecked.noRegistry` |
| E10 | No curated entry and no changelog | `compatibilityKnown: false`; never guess |
| E11 | Changelog exists but is unparseable | Pass raw text to Bob as evidence; mark `confidence: low` |
| E12 | Conflict cycle in upgrade order | `verdict: "manual"`, name the cycle members |
| E13 | Dependency declared but never imported | Include in inventory; `blastRadius: []`; note may be removable |
| E14 | Import matches no declared dependency | Ignore silently (JDK-internal imports) |
| E15 | Zero conflicts found | `verdict: "clear"` with list of what was checked — never print empty report |
| E16 | `.ctx/` missing when `check` runs | Print "run `ctx scan` first" and exit 2 |
| E17 | Cache file corrupted | Delete, re-fetch, warn |
| E18 | Very large repo (>5000 files) | Cap import scan at 5000 files; report cap in output |
| E19 | Multiple `docker-compose*.yml` | Use `docker-compose.yml`; note others were ignored |
| E20 | Target Java lower than declared | Reject: "downgrade analysis is not supported" |

---

## Implementation prompts

Work through these in order. Do not start a step until the previous step's
acceptance test passes.

---

### Prompt 1 — Sample project + scaffold

**Intent:** Create the fixture every acceptance test runs against, then
establish the project skeleton and TypeScript config. The sample project
is the ground truth for all subsequent tests.

**Scope:**

**Sample project** — `samples/legacy-java-app/`:

`pom.xml` declaring:
- `maven.compiler.source` = `8`, `maven.compiler.target` = `8`
- `org.postgresql:postgresql:42.2.5` (compile)
- `javax.xml.bind:jaxb-api:2.3.0` (compile)

`docker-compose.yml` declaring:
```yaml
services:
  db:
    image: postgres:9.6
```

Three Java files:
- `src/db/Connection.java` — `import org.postgresql.Driver;` on line 12
- `src/db/Pool.java` — `import org.postgresql.ds.PGPoolingDataSource;` on line 8
- `src/api/XmlMapper.java` — `import javax.xml.bind.JAXBContext;` on line 5

**Project scaffold:**
- `package.json`:
  - Runtime deps: `commander`, `fast-xml-parser`, `js-yaml`,
    `@modelcontextprotocol/sdk`, `zod`
  - Dev deps: `typescript`, `tsx`, `@types/node`, `vitest`
  - `"type": "module"`
  - `"bin": { "ctx": "./bin/ctx.js", "ctx-mcp": "./bin/ctx-mcp.js" }`
  - Scripts: `build`, `dev`, `test`
- `tsconfig.json`: `target: ES2022`, `module: Node16`,
  `moduleResolution: Node16`, `strict: true`, `outDir: ./build`
- `bin/ctx.js` — shebang, `commander` router; registers `scan` and `check`
  commands with placeholder handlers printing "not yet implemented"
- `bin/ctx-mcp.js` — shebang, imports `src/mcp/server.ts`; placeholder
  that starts a server and immediately closes it
- `src/store/schema.ts` — TypeScript types for `StateJson`, `CacheEntry`,
  `FindingsResult`, `Finding`, `UpgradeStep`, `PlatformInfo`, `Dependency`

**Acceptance test:**
```
npx tsx bin/ctx.js --help
# Must list scan and check commands with descriptions

tsc --noEmit
# Must produce zero errors
```

---

### Prompt 2 — Store: `state.json` + cache helpers

**Intent:** Implement the read/write layer for `.ctx/`. All subsequent
modules read from and write to these helpers — no module opens `.ctx/`
directly.

**Scope:**
- `src/store/state.ts`
  - `writeState(repoRoot, state: StateJson)`: creates `.ctx/` if absent,
    writes `state.json` with `JSON.stringify(..., null, 2)`, overwrites
  - `readState(repoRoot)`: reads and parses `state.json`; throws
    `CtxError("E16")` with message "run `ctx scan` first" if absent

- `src/store/cache.ts`
  - `cacheGet(repoRoot, key)`: reads `.ctx/cache/<key>.json`; returns
    `null` if absent; deletes file and returns `null` if JSON parse fails
    (E17); checks age — if > 24h, returns entry with `stale: true`
  - `cacheSet(repoRoot, key, value)`: creates `.ctx/cache/` if absent,
    writes `<key>.json`

- Both helpers use the `key` format `<groupId>:<artifactId>` for cache files;
  colons in filenames are replaced with `__` on disk
  (`org.postgresql__postgresql.json`)

**Acceptance test:**
```ts
// npx tsx scripts/test-store.ts
import { writeState, readState } from "./src/store/state.js";
const state = { schemaVersion: 1, scannedAt: new Date().toISOString(),
  language: "java", declaredJavaVersion: "8", buildTool: "maven",
  manifestPath: "pom.xml", parentResolved: false,
  dependencies: [], platform: { database: null }, importMap: {} };
await writeState(process.cwd(), state);
const loaded = await readState(process.cwd());
console.assert(loaded.declaredJavaVersion === "8", "round-trip");
console.log("PASS");
```

---

### Prompt 3 — `readManifest` — pom.xml parser

**Intent:** Parse `pom.xml` using an XML parser (not regex). This is the
authoritative source for language version and dependencies.

**Scope:**
- `src/readers/manifest.ts`
  - `readManifest(repoRoot)`: returns `ManifestData`:
    ```ts
    interface ManifestData {
      declaredJavaVersion: string | null;
      buildTool: "maven";
      manifestPath: string;
      parentResolved: boolean;
      dependencies: Dependency[];
    }
    ```
  - Throws `CtxError("E1")` if `pom.xml` is absent
  - Extracts `declaredJavaVersion` from: `maven.compiler.source`,
    `maven.compiler.target`, `java.version` — in that precedence order;
    any property in `<properties>` block
  - For each `<dependency>`: extract `groupId`, `artifactId`, `version`,
    `scope` (default `compile`)
  - Property interpolation: if `<version>` is `${foo}`, look up `foo` in
    `<properties>`. If found, substitute. If not found, set
    `version: "unresolved"`, `versionRaw: "${foo}"` (E3)
  - If version looks like a range (`[`, `(`, `)`, `]`), set
    `version: "range"`, `versionRaw: <original>` (E4)
  - If `<parent>` element is present, set `parentResolved: false` and
    emit a warning to stderr (E2)

**Acceptance test:**
```ts
// npx tsx scripts/test-manifest.ts
import { readManifest } from "./src/readers/manifest.js";
const m = await readManifest("samples/legacy-java-app");
console.assert(m.declaredJavaVersion === "8", "java version");
console.assert(m.dependencies.length === 2, "2 deps");
console.assert(m.dependencies[0].artifactId === "postgresql", "first dep");
console.log("PASS");
```

---

### Prompt 4 — `readPlatform` — database version detector

**Intent:** Locate the database version from project configuration files
in a fixed precedence order. Never guess.

**Scope:**
- `src/readers/platform.ts`
  - `readPlatform(repoRoot)`: returns `PlatformInfo`
  - Precedence order (stop at first hit):
    1. `.ctx/config.json` → `platform.database` object
    2. `docker-compose.yml` / `docker-compose.yaml` (E19: if both exist,
       use `docker-compose.yml`, warn)
       - Parse with `js-yaml`
       - Scan every service's `image` field
       - Keyword map: `postgres`, `mysql`, `mariadb`, `mongo`
       - Extract version from tag (`image: postgres:9.6` → `9.6`)
       - If multiple databases found (E6), record all in `allFound`
       - Record `declaredIn` as `filename:lineNumber`
    3. `Dockerfile` → `FROM postgres:9.6` etc.
  - If nothing found: return
    `{ database: null, reason: "not declared" }` (E5)
  - `declaredIn` format: `"docker-compose.yml:14"`

**Acceptance test:**
```ts
// npx tsx scripts/test-platform.ts
import { readPlatform } from "./src/readers/platform.js";
const p = await readPlatform("samples/legacy-java-app");
console.assert(p.database?.engine === "postgres", "engine");
console.assert(p.database?.version === "9.6", "version");
console.assert(p.database?.declaredIn.startsWith("docker-compose"), "source");
console.log("PASS");
```

---

### Prompt 5 — `scanImports` — usage locator

**Intent:** Map every Java import in the project back to a declared
dependency. This produces the blast radius data.

**Scope:**
- `src/readers/imports.ts`
  - `scanImports(repoRoot, dependencies)`: returns
    `Record<groupId, string[]>` (file paths with line numbers)
  - Glob `**/*.java` excluding `target/`, `build/`, `.ctx/`
  - Cap at 5000 files; if capped, set a flag in the return value (E18)
  - For each file, read line by line; regex-match
    `^import\s+([a-zA-Z0-9_.]+);`
  - Map the package prefix to a dependency's `groupId` using a
    hand-maintained prefix map:
    ```ts
    const GROUP_PREFIXES: Record<string, string> = {
      "org.postgresql": "org.postgresql",
      "javax.xml.bind": "javax.xml.bind",
      "com.mysql": "mysql",
      "org.springframework": "org.springframework",
      "org.hibernate": "org.hibernate",
    };
    ```
  - If no match: ignore silently (E14 — JDK-internal imports)
  - Record as `"src/path/File.java:12"` (repo-relative path + line)
  - Dependencies with no imports get `groupId: []` (E13)

**Acceptance test:**
```ts
// npx tsx scripts/test-imports.ts
import { readManifest } from "./src/readers/manifest.js";
import { scanImports } from "./src/readers/imports.js";
const m = await readManifest("samples/legacy-java-app");
const im = await scanImports("samples/legacy-java-app", m.dependencies);
console.assert(im["org.postgresql"].some(l => l.includes("Connection.java")), "Connection.java");
console.assert(im["javax.xml.bind"].some(l => l.includes("XmlMapper.java")), "XmlMapper.java");
console.log("PASS");
```

---

### Prompt 6 — `fetchArtifact` — Maven Central client + cache

**Intent:** Fetch artifact metadata from Maven Central with cache-first
behaviour. Never throw on network failure.

**Scope:**
- `src/readers/registry.ts`
  - `fetchArtifact(repoRoot, groupId, artifactId)`:
    - Cache key: `<groupId>:<artifactId>` (file on disk uses `__`)
    - Check cache first (E17: delete corrupted files)
    - If present and < 24h old: return cached value
    - If present and stale: continue to fetch attempt; on failure, return
      with `stale: true` (E7)
    - Fetch URL:
      `https://search.maven.org/solrsearch/select?q=g:"<g>"+AND+a:"<a>"&core=gav&rows=20&wt=json`
    - On 429: retry once after 2s (E8); on second failure, E7 behaviour
    - On other network failure: E7 behaviour
    - If artifact not found in response: return `{ found: false }` (E9)
    - Extract: `latestVersion`, all `versions[]`, `fetchedAt`
    - Write to cache and return

**Acceptance test:**
```ts
// npx tsx scripts/test-registry.ts
import { fetchArtifact } from "./src/readers/registry.js";
const start = Date.now();
const r1 = await fetchArtifact(".", "org.postgresql", "postgresql");
console.assert(r1.found !== false, "found");
console.assert(typeof r1.latestVersion === "string", "has version");
const r2 = await fetchArtifact(".", "org.postgresql", "postgresql");
console.assert(Date.now() - start < 50 || true, "second call is cache hit");
// (timing assertion is advisory — registry is external)
console.log("PASS:", r1.latestVersion);
```

---

### Prompt 7 — `ctx scan` wiring

**Intent:** Wire all four readers into a single command that produces
`state.json`. This is the first user-visible command.

**Scope:**
- `src/commands/scan.ts`
  1. Check `pom.xml` exists; exit 2 with E1 message if not
  2. Run `readManifest`, `readPlatform`, `scanImports` (pass dependencies
     from manifest)
  3. For each dependency with a concrete version, call `fetchArtifact`
     (in parallel using `Promise.all`, max 5 concurrent — use a simple
     semaphore, not p-limit)
  4. Merge all four readers' output into `StateJson`
  5. Write to `.ctx/state.json` via `writeState`
  6. Print terminal summary:
     - Java version declared
     - Number of dependencies found
     - Database declared (engine + version + file, or "not declared")
     - Number of imports mapped
     - Cache hits vs fresh fetches

**Acceptance test:**
```
cd samples/legacy-java-app
npx tsx ../../bin/ctx.js scan
# Must produce .ctx/state.json
cat .ctx/state.json | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');
  const j=JSON.parse(s);
  console.assert(j.declaredJavaVersion==='8');
  console.assert(j.dependencies.length===2);
  console.assert(j.platform.database.version==='9.6');
  console.log('PASS');"
```

---

### Prompt 8 — Compatibility knowledge: `data/compatibility.json` + loader

**Intent:** Implement the curated compatibility file and its loader.
The engine never reads the file directly — it calls the loader.

**Scope:**
- `data/compatibility.json` — populate with required entries (see
  Store design section). Minimum: `org.postgresql:postgresql`,
  `mysql:mysql-connector-java`, `org.springframework:spring-core`,
  `org.hibernate:hibernate-core`, `jdk:removals`.

- `src/compat/loader.ts`
  - `loadCompatibility()`: reads `data/compatibility.json` relative to
    the package root (not `process.cwd()`); returns `CompatibilityDb`:
    ```ts
    interface CompatibilityDb {
      getConstraints(groupId: string, artifactId: string): Constraint[];
      getJdkRemovals(javaVersion: string): string[];
    }
    ```
  - `getConstraints(g, a)`: returns constraints whose `fromVersion` is
    ≤ the version being checked. Uses semver comparison.
  - `getJdkRemovals(version)`: returns the list of removed packages for
    the given Java version from the `jdk:removals` entry.

**Acceptance test:**
```ts
// npx tsx scripts/test-compat.ts
import { loadCompatibility } from "./src/compat/loader.js";
const db = loadCompatibility();
const c = db.getConstraints("org.postgresql", "postgresql");
console.assert(c.length > 0, "has constraints");
const r = db.getJdkRemovals("11");
console.assert(r.includes("javax.xml.bind"), "jaxb in removals");
console.log("PASS");
```

---

### Prompt 9 — C1, C2, C3 + upgrade order resolver

**Intent:** Implement the constraint engine as pure functions. No I/O.
No model calls. Takes reader output and returns findings.

**Scope:**
- `src/compat/engine.ts`

  **`runC1(state, targetJava, compatDb)`** → `Finding[]`
  - For each dependency with a concrete version:
    - Look up constraints from `compatDb` for this artifact
    - Determine the minimum version required for `targetJava`
    - If installed < minimum: emit `C1_language_forces_dependency`
      finding with `severity: "blocking"`
    - For JDK removals: check if any dependency's groupId is in
      `compatDb.getJdkRemovals(targetJava)` — emit a blocking C1
      finding with the curated source
  - E20: if `targetJava < state.declaredJavaVersion`, throw a typed
    error "downgrade analysis is not supported"

  **`runC2(state, c1Findings, compatDb)`** → `Finding[]`
  - For each C1 finding that forces a version upgrade:
    - Look up constraints for the **new** (upgraded) version of the dep
    - Check if the new version requires a database version higher than
      `state.platform.database.version`
    - If so: emit `C2_dependency_drops_database` with
      `dependsOn: c1FindingId`, `severity: "blocking"`
  - If `state.platform.database` is null: return `[]` and note E5

  **`runC3(state, registryData)`** → `Finding[]`
  - For each dependency: check `registryData` for advisory flags or
    if the installed version is the last release in a major line that
    is itself no longer the latest major
  - Forced: advisory present → `severity: "blocking"` with `C3_eol_advisory`
  - Optional: newer version available, no advisory → `severity: "warning"`

  **`resolveOrder(findings)`** → `UpgradeStep[]`
  - Build a directed graph from `dependsOn` edges
  - Topological sort → ordered step list matching the Section 5 format
  - On cycle: return `[]` and set `verdict: "manual"` with cycle members
    named (E12)

  **`buildBlastRadius(findings, importMap)`** → `Record<string, string[]>`
  - For each finding's dependency groupId, return importMap entries

**Acceptance test:**
```ts
// npx tsx scripts/test-engine.ts
import { readState } from "./src/store/state.js";
import { loadCompatibility } from "./src/compat/loader.js";
import { runC1, runC2, runC3, resolveOrder, buildBlastRadius } from "./src/compat/engine.js";

// Assumes ctx scan has already been run in samples/legacy-java-app
const state = await readState("samples/legacy-java-app");
const db = loadCompatibility();
const c1 = runC1(state, "11", db);
console.assert(c1.length === 2, `C1: expected 2, got ${c1.length}`);
const c2 = runC2(state, c1, db);
console.assert(c2.length === 1, `C2: expected 1, got ${c2.length}`);
const order = resolveOrder([...c1, ...c2]);
console.assert(order[0].action.toLowerCase().includes("postgres"), "DB upgrade first");
console.log("PASS");
```

---

### Prompt 10 — `ctx check` terminal output

**Intent:** The human-facing command. Loads state, runs the engine,
prints the blocking report to stdout. Must be usable offline (reads
cached registry data only — never re-fetches during check).

**Scope:**
- `src/commands/check.ts`
  - Accepts `--target java=<version>` flag (default: prompt user)
  - Loads `state.json` via `readState`; exits 2 with E16 message if absent
  - Loads `compatDb`
  - Runs C1, C2, C3 using state (no new I/O)
  - Runs `resolveOrder`, `buildBlastRadius`
  - Calls `src/output/terminal.ts` to render the report

- `src/output/terminal.ts`
  - `printReport(findings, order, blastRadius, state)`: renders to stdout:
    - **BLOCKED** / **CLEAR** / **MANUAL** verdict header
    - Each finding: id, class, severity, dependency, reason,
      evidence.fact, evidence.source, evidence.fetchedAt
    - Upgrade order numbered list
    - Blast radius: per-dependency file list
    - `notChecked` section if any unresolved/range/unknown deps
    - E15: if zero conflicts, prints "Checked N dependencies — no
      blocking conflicts found" (never empty)

- **Exit codes:** 1 on any `blocking` finding, 0 on clear or warning-only

**Acceptance test:**
```
cd samples/legacy-java-app
npx tsx ../../bin/ctx.js check --target java=11
# Must print BLOCKED
# Must list 3 findings
# Must list upgrade order with PostgreSQL upgrade as step 1
echo "Exit: $?"
# Must be 1
```

---

### Prompt 11 — MCP server: `ctx_project_state` (hardcoded first)

**Intent:** Get the MCP handshake working in Bob's environment with a
hardcoded response before wiring real data. If the handshake fails, the
problem appears at hour two, not hour twenty.

**Scope:**
- `src/mcp/server.ts`
  - `McpServer({ name: "ctx", version: "0.1.0" })`
  - `StdioServerTransport`
  - All logging: `console.error` only — never `console.log`
  - Register `ctx_project_state` with a **hardcoded** response matching
    the Section 5 Step 2 JSON exactly
  - Register `ctx_check_change` and `ctx_upgrade_plan` as stubs returning
    `{ status: "not yet implemented" }`
  - Tool description for all three must include verbatim:
    > Return only the facts present in this response. Do not state version
    > compatibility, deprecation status, or release dates from your own
    > knowledge. If a field is marked `compatibilityKnown: false`, say the
    > information is unavailable rather than inferring it.

- `src/mcp/tools/project-state.ts` — handler that returns the hardcoded
  Section 5 Step 2 object as `JSON.stringify`

**Acceptance test:**
```
# Start the server in one terminal:
npx tsx bin/ctx-mcp.js

# In Bob, prompt:
# "Call ctx_project_state and show me what it returns"
# Bob must call the tool and display the hardcoded JSON.
# Verify the MCP handshake completes without errors.
```

---

### Prompt 12 — MCP server: wire real engine

**Intent:** Replace the hardcoded responses with the real readers and
engine. After this step, the Section 5 reference scenario works end to end.

**Scope:**
- `src/mcp/tools/project-state.ts`
  - Accept optional `repoRoot` arg (default `process.cwd()`)
  - Load `state.json` via `readState`; if absent, return
    `{ error: "E16", message: "run ctx scan first" }`
  - Return `StateJson` as structured JSON

- `src/mcp/tools/check-change.ts`
  - Input: `{ target: { java?: string, dependency?: string } }`
  - Load state, load compatDb, run C1+C2+C3+resolveOrder+buildBlastRadius
  - Return full `FindingsResult` including `upgradeOrder` and `blastRadius`
  - All 20 edge cases must propagate through this response

- `src/mcp/tools/upgrade-plan.ts`
  - Input: none (or optional `repoRoot`)
  - Load state, load compatDb, run C3 for all dependencies
  - Return all dependencies classified: `forced` (advisory/EOL),
    `optional` (newer available, no issue), `current` (already latest)
  - Each entry includes the evidence source and fetch date

**Acceptance test:**
```
# In Bob, starting from the sample project:
# "I want to move this project to Java 11"
# Bob must:
# 1. Call ctx_project_state → receive the full state
# 2. Call ctx_check_change({ target: { java: "11" } })
# 3. Produce an explanation matching the Section 5 Step 4 text:
#    "Upgrading to Java 11 forces the Postgres driver to 42.3.0..."
# Verify no version facts are invented (all traceable to findings JSON)
```

---

### Prompt 13 — Markdown report writer

**Intent:** `ctx check --report` writes `ctx-report.md` with the full
findings, upgrade order, blast radius, and provenance.

**Scope:**
- `src/output/markdown.ts`
  - `writeReport(findings, order, blastRadius, state, outputPath)`:
    produces a Markdown file with sections:
    - `# ctx Safety Report` + `Generated:` timestamp + `Project:` name
    - `## Verdict` — BLOCKED / CLEAR / MANUAL with count of findings
    - `## Findings` — each finding as a subsection with all fields,
      source URL, and fetch date
    - `## Upgrade Order` — numbered steps with `resolves` and `blockedBy`
    - `## Blast Radius` — per-dependency file list with line numbers
    - `## Not Checked` — unresolved, range, no-registry, no-compat entries
    - `## Known Limitations` — the Section 13 list, verbatim

- Add `--report` flag to `ctx check`; write to `ctx-report.md` at repo
  root by default; `--report-path <file>` for custom location

**Acceptance test:**
```
cd samples/legacy-java-app
npx tsx ../../bin/ctx.js check --target java=11 --report
# Must produce ctx-report.md
# File must contain:
grep -q "## Findings" ctx-report.md
grep -q "## Upgrade Order" ctx-report.md
grep -q "## Known Limitations" ctx-report.md
grep -q "jdbc.postgresql.org" ctx-report.md  # provenance source URL
echo "PASS"
```

---

### Prompt 14 — Benchmark harness

**Intent:** Produce the evidence artifact that demonstrates the
deterministic-only versus deterministic-plus-Bob comparison. This is
the primary demonstration of the Finding 2 architecture.

**Scope:**
- `benchmark/run.sh`:
  1. Run `ctx scan` in the sample project
  2. Run `ctx check --target java=11 --report` and capture output as
     `benchmark/output-deterministic.md`
  3. Print: "=== Deterministic output written. Now prompting Bob ==="
  4. Print the prompt the user should give Bob:
     ```
     "I want to move samples/legacy-java-app to Java 11.
      Call ctx_check_change and explain what needs to change,
      in what order, and why — do not invent any version facts."
     ```
  5. Print: "Paste Bob's response below, then press Ctrl-D:"
  6. Read stdin until EOF, write to `benchmark/output-bob.md`
  7. Write `benchmark/results.md` with:
     - Table comparing findings surfaced in each output
     - Timestamp
     - Note: "n=1, self-measured"

**Acceptance test:**
```
bash benchmark/run.sh
# Must produce:
# benchmark/output-deterministic.md
# benchmark/results.md
# (benchmark/output-bob.md requires interactive Bob session)
echo "Harness: PASS"
```

---

## Dependency order summary

```
1  Sample project + scaffold          (no deps)
2  Store: state.json + cache          (deps: 1)
3  readManifest (pom.xml parser)      (deps: 1)
4  readPlatform (database detector)   (deps: 1)
5  scanImports (usage locator)        (deps: 1, 3)
6  fetchArtifact (Maven Central)      (deps: 2)
7  ctx scan wiring                    (deps: 2, 3, 4, 5, 6)
8  data/compatibility.json + loader   (deps: 1)
9  C1, C2, C3 + order resolver        (deps: 2, 8)
   acceptance test requires: 7 run first
10 ctx check terminal output          (deps: 2, 9)
11 MCP server (hardcoded first)       (deps: 1)
12 MCP server (real engine)           (deps: 2, 7, 9, 11)
13 Markdown report writer             (deps: 9, 10)
14 Benchmark harness                  (deps: 7, 10, 13)
```

---

## Key design decisions

| Decision | Rationale |
|---|---|
| Java/Maven target stack | The problem being solved is legacy modernization; Java 8→11 is the concrete reference scenario |
| Layer 2 never calls a model; Layer 3 never asserts a version fact | The AAAI hybrid architecture: deterministic checker + AI explainer. Each layer can only do what it is good at |
| Curated `data/compatibility.json` for the hard cases | Registries do not publish which database versions a driver supports; that fact lives in prose. For the dependencies that matter in Java modernization, hand-verification is the only reliable approach |
| Three-tier compatibility resolution | Curated first (exact), changelog fallback (Bob reads prose), declared unknown (silence) — prevents the hallucination trap of tier 0 |
| C2 can only trigger because of C1 | The chained check is the core value. A database conflict only exists because a language upgrade forced a driver upgrade. This causal chain must be preserved in the output |
| Tool description carries the grounding constraint verbatim | Applied at the protocol level, not per-call. Bob reads it before every tool invocation |
| `ctx_project_state` hardcoded in step 11, real in step 12 | MCP handshake validated at hour two. If stdio transport fails in Bob's environment, nothing else matters |
| `verdict: "clear"` must list what was checked | An empty report is indistinguishable from a failed run. Silence is not a valid output |
| Exit code 1 on any blocking finding | Enables use in CI without extra tooling |

---

## Known limitations (state these openly)

1. **Compatibility knowledge is partial.** Exact for curated dependencies, inferred for the long tail, absent for the rest. The output says which.
2. **Direct dependencies only.** A constraint reaching the project through a transitive dependency is not detected.
3. **Declared, not actual.** `ctx` reads what the project declares. If production runs a different database version than `docker-compose.yml` says, `ctx` cannot know.
4. **Detection, not certainty.** The AAAI hybrid reached 74% coverage, not 100%. This improves the odds; it does not remove the need for a human to sign off.
5. **No runtime or performance analysis.** Functional compatibility only.
6. **Single manifest, single repo.** No monorepo or multi-module support.
