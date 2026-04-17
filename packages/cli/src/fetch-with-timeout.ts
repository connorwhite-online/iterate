/**
 * fetch() helper with an AbortController timeout. Without this, CLI commands
 * that hit a half-dead daemon (e.g. hung on an iteration startup) would wait
 * indefinitely. Default timeout is 8s — long enough for slow responses, short
 * enough that "is it dead?" is clear.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, signal: userSignal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // If the caller passed their own signal, link them.
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort();
    else userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON response, returning null on empty/invalid bodies. */
export async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
