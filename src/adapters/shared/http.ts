const RETRY_DELAY_MS = 2000;

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return null;
  }

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      res = await fetch(url, { headers });
    } catch {
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
