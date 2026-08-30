import { compareSemver } from "./loader.js";

export interface ChangelogInference {
  parseable: boolean;
  minVersion: string | null;
  note: string;
}

interface ArtifactMatch {
  languageVersion: string;
  artifactVersion: string;
}

function extractMatches(text: string, language: string): ArtifactMatch[] {
  const lang = language === "node" ? "node(?:\\.js)?" : language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: Array<{ re: RegExp; langGroup: number; artGroup: number }> = [
    {
      re: new RegExp(
        `${lang}\\s+(\\d+(?:\\.\\d+)*)[^\\n]{0,60}?(?:requires|minimum|use|added in|starts at)\\s+(?:version\\s+)?(\\d+\\.\\d+[\\w.-]*)`,
        "gi",
      ),
      langGroup: 1,
      artGroup: 2,
    },
    {
      re: new RegExp(
        `(?:requires|minimum|use)\\s+(?:version\\s+)?(\\d+\\.\\d+[\\w.-]*)[^\\n]{0,60}?for\\s+${lang}\\s+(\\d+(?:\\.\\d+)*)`,
        "gi",
      ),
      langGroup: 2,
      artGroup: 1,
    },
  ];

  const matches: ArtifactMatch[] = [];
  for (const { re, langGroup, artGroup } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const languageVersion = m[langGroup];
      const artifactVersion = m[artGroup];
      if (!languageVersion || !artifactVersion) continue;
      if (!/^\d+\.\d+/.test(artifactVersion)) continue;
      matches.push({ languageVersion, artifactVersion });
    }
  }
  return matches;
}

/**
 * Infer a minimum *artifact* version for a language target from changelog text.
 * Language-only phrases ("requires Java 11") are unparseable — never guess.
 */
export function parseChangelog(
  text: string | undefined | null,
  language: string,
  targetVersion?: string,
): ChangelogInference {
  if (text === undefined || text === null || !String(text).trim()) {
    return { parseable: false, minVersion: null, note: "E10: no changelog" };
  }

  const matches = extractMatches(String(text), language);
  let applicable = matches;
  if (targetVersion) {
    applicable = matches.filter((m) => compareSemver(targetVersion, m.languageVersion) >= 0);
  }

  if (applicable.length === 0) {
    return { parseable: false, minVersion: null, note: "E11: unparseable changelog" };
  }

  let bestLang: string | null = null;
  let bestArt: string | null = null;
  for (const m of applicable) {
    if (bestLang === null || compareSemver(m.languageVersion, bestLang) > 0) {
      bestLang = m.languageVersion;
      bestArt = m.artifactVersion;
    }
  }

  return {
    parseable: true,
    minVersion: bestArt,
    note: `Inferred from changelog: ${language} ${bestLang} requires ${bestArt}`,
  };
}
