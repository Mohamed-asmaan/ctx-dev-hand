const RETRY_DELAY_MS = 2000;

export const CTX_USER_AGENT =
  "ctx/0.1.0 (+https://github.com/Mohamed-asmaan/ctx-dev-hand)";

let tlsWarned = false;
export let registryReachError: string | null = null;

export function resetRegistryReachError(): void {
  registryReachError = null;
  tlsWarned = false;
}

function flattenFetchError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 4 && current; i++) {
    if (current instanceof Error) {
      parts.push(current.message);
      const code = (current as NodeJS.ErrnoException).code;
      if (code) parts.push(code);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" ");
}

function warnFetchFailure(err: unknown): void {
  const msg = flattenFetchError(err);
  registryReachError = msg;
  if (!/CERT|SSL|UNABLE_TO_|verify the first certificate|self signed|issuer|fetch failed/i.test(msg)) {
    return;
  }
  if (tlsWarned) return;
  tlsWarned = true;
  process.stderr.write(
    `[ctx warn] Could not reach the package registry (${msg}). Scan still recorded libraries from the build file.\n`,
  );
}

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const merged = {
    "User-Agent": CTX_USER_AGENT,
    Accept: "application/json",
    ...headers,
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: merged });
  } catch (err) {
    warnFetchFailure(err);
    return null;
  }

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      res = await fetch(url, { headers: merged });
    } catch (err) {
      warnFetchFailure(err);
      return null;
    }
    if (res.status === 429) return null;
  }

  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
