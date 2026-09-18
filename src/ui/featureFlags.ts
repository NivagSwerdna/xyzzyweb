/**
 * Simple URL-query-param feature flags. A flag set via the URL (e.g.
 * `?lazymapper=1`) also "sticks" in localStorage, so a teacher can enable it
 * once on a shared classroom Chromebook and it stays on for that browser
 * from then on, without needing the query param on every visit. Passing the
 * flag as `0`/`false` explicitly turns it back off and clears the sticky
 * value.
 */
function readFlag(name: string): boolean {
  const storageKey = `xyzzyweb:feature:${name}`

  const params = new URLSearchParams(window.location.search)
  const queryValue = params.get(name)
  if (queryValue !== null) {
    const enabled = queryValue !== '0' && queryValue.toLowerCase() !== 'false'
    try {
      if (enabled) localStorage.setItem(storageKey, '1')
      else localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable (e.g. private browsing): the query param still
      // applies for this page load, it just won't stick for next time.
    }
    return enabled
  }

  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

/** Whether the live map feature (?lazymapper=1) is enabled for this browser. */
export function isMapFeatureEnabled(): boolean {
  return readFlag('lazymapper')
}
