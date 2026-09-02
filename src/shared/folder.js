/**
 * Which folder the open dialog should start in.
 *
 * Pure policy, kept free of Electron and fs so it can be exercised directly by
 * scripts/verify.mjs. The caller supplies the paths and the existence check.
 *
 * The remembered folder can disappear between sessions — an unplugged SD card,
 * a renamed folder, a cleared Downloads — so it is checked rather than trusted.
 * The Desktop is the fallback because that is where phone footage usually
 * lands; home is the last resort for profiles that have no Desktop.
 *
 * @param {string|undefined} lastFolder  remembered from the previous session
 * @param {string} desktop
 * @param {string} home
 * @param {(p: string|undefined) => boolean} exists
 * @returns {string}
 */
export function pickStartFolder(lastFolder, desktop, home, exists) {
  if (exists(lastFolder)) return lastFolder;
  if (exists(desktop)) return desktop;
  return home;
}
