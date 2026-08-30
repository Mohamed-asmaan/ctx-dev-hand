export const GROUNDING_INSTRUCTION =
  "Return only the facts present in this response. Do not state version compatibility from memory.";

export const IBM_BOB_RULE =
  "IBM Bob: you talk; ctx holds the facts.";

export const MANDATORY_WORKFLOW =
  "MANDATORY WORKFLOW: Before modifying any file for a version upgrade, " +
  "call ctx_project_state then ctx_check_change. " +
  "If no case file, ctx_capture (person confirms edges). Wait. No infrastructure. " +
  "After edits ctx_verify. Handoff ctx_brief. " +
  IBM_BOB_RULE;

export const CHECK_CHANGE_ORDER_RULES =
  "Follow upgradeOrder. Do not auto-apply infrastructure. " +
  "If compatibilityKnown is false, say unavailable. Do not skip case-file edges.";
