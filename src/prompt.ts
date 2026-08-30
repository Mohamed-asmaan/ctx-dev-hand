// One short block. Written only while ctx is ON. Off deletes it.
// File existing = ON. Do not mention config.json or "if off ignore this".

export const CTX_ON_BODY = `ctx ON. This file means ctx is on. Do not skip. Do not guess versions.

IBM Bob: you talk; ctx holds the facts. Decisions live in .ctx/case.json. After a person confirms, call ctx_capture (locks/edges/decisions). Do not invent them. Read them with ctx show.

Upgrade/modernize: ctx_project_state → ctx_capture if no case file → ctx_check_change. Show findings and upgradeOrder. Wait. Never apply a step whose kind is infrastructure. After edits: ctx_verify. Handoff: ctx_brief.
`;

export const CTX_GATE_MD = `# ctx

${CTX_ON_BODY}`;

export const CTX_RULE_MDC = `---
description: ctx is ON
alwaysApply: true
---

${CTX_ON_BODY}`;
