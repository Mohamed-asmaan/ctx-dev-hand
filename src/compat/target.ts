export interface ParsedTarget {
  key: string;
  value: string;
}

export function parseTarget(targetSpec: string): ParsedTarget | null {
  const m = targetSpec.match(/^([A-Za-z][A-Za-z0-9._-]*)[=:](.+)$/);
  if (!m) return null;
  return { key: m[1].toLowerCase(), value: m[2].trim() };
}

export function isRuntimeVersion(value: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(value);
}

export function isVersionUpgrade(stateLanguage: string, target: ParsedTarget): boolean {
  return target.key === stateLanguage && isRuntimeVersion(target.value);
}
