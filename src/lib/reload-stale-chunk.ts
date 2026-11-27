const RELOAD_KEY = "wab.chunk-reload";
const RELOAD_WINDOW_MS = 15_000;

export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    message,
  );
}

export function reloadOnceForStaleChunk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
    const now = Date.now();
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* ignore storage failures and still reload */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("__psxl_chunk_retry", String(now));
  window.location.replace(url.toString());
  return true;
}

export function handleStaleChunkError(error: unknown): boolean {
  if (!isStaleChunkError(error)) return false;
  return reloadOnceForStaleChunk();
}
