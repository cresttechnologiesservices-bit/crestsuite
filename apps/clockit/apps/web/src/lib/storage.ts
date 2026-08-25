/**
 * Local storage keys are namespaced "clockit.*" since the rename. Existing
 * browsers still hold values under the old "clockify.*" names, so the first
 * read after upgrading moves them across instead of silently losing saved
 * filters and favourites.
 */
export function clockitKey(suffix: string): string {
  const key = `clockit.${suffix}`;
  try {
    const legacy = `clockify.${suffix}`;
    const existing = localStorage.getItem(legacy);
    if (existing !== null && localStorage.getItem(key) === null) {
      localStorage.setItem(key, existing);
    }
    if (existing !== null) localStorage.removeItem(legacy);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) — the caller
    // still gets a usable key name
  }
  return key;
}
