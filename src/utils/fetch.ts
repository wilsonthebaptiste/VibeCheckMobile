/**
 * React Native's fetch does not reliably throw a standard DOMException named
 * 'AbortError' on abort. In practice it can wrap the abort as a plain Error
 * -- e.g. "fetch failed: Fetch request has been canceled", with the original
 * abort hanging off `.cause`.
 *
 * Checking only `error.name === 'AbortError'` misses that, which caused a real
 * bug: a deliberately-aborted stale request was treated as a network failure
 * and blanked the whole map with an error screen while panning. Match on
 * message content too, and recurse into `.cause`.
 */
export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError') {
    return true;
  }
  if (/abort|cancel/i.test(error.message)) {
    return true;
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? isAbortError(cause) : false;
}
