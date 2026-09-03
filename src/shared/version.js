/**
 * Version comparison and release-asset selection.
 *
 * Pure, free of Electron and fs, so scripts/verify.mjs can exercise it
 * directly — the same reason shared/folder.js is shaped this way. Getting this
 * wrong is not cosmetic: a comparison that always says "newer" puts the app in
 * a download loop, and one that always says "older" means updates never ship.
 */

/**
 * "v1.2.3", "1.2.3", "1.2" and "1.2.3-beta.1" all parse. Anything else is not
 * a version we can compare, and the caller must say so rather than guess.
 *
 * @param {string} raw
 * @returns {{major:number, minor:number, patch:number, pre:string}|null}
 */
export function parseVersion(raw) {
  if (typeof raw !== 'string') return null;

  // Drop a leading v, and any build metadata — "+build" never affects ordering.
  const trimmed = raw.trim().replace(/^[vV]/, '').split('+')[0];
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/.exec(trimmed);
  if (!m) return null;

  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
    pre: m[4] ?? '',
  };
}

/**
 * Standard semver ordering: numeric triple first, then a prerelease sorts
 * BELOW the release it leads to — 1.1.0-beta is older than 1.1.0, so someone
 * on the beta still gets offered the final.
 *
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) return 0;

  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;

  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Is the published tag worth offering to someone running `current`?
 * Unparseable input answers false — never offer an update we can't reason about.
 */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  return compareVersions(a, b) > 0;
}

/**
 * Choose the zip to download from a GitHub release's assets.
 *
 * Prefers one whose name ends with the app's suffix (`-x64.zip`), so a release
 * that later adds an arm64 build doesn't start handing x64 machines the wrong
 * one. Falls back to the first zip, because a single-asset release is the
 * normal case and refusing it would be pedantic.
 *
 * @param {Array<{name?:string, browser_download_url?:string, size?:number}>} assets
 * @param {string} suffix
 */
export function pickReleaseAsset(assets, suffix) {
  const zips = (Array.isArray(assets) ? assets : []).filter(
    (a) => typeof a?.name === 'string' &&
           a.name.toLowerCase().endsWith('.zip') &&
           typeof a?.browser_download_url === 'string' &&
           a.browser_download_url.length > 0
  );
  if (zips.length === 0) return null;

  const wanted = String(suffix || '').toLowerCase();
  const exact = wanted && zips.find((a) => a.name.toLowerCase().endsWith(wanted));
  return exact || zips[0];
}
