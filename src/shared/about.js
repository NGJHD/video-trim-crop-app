/**
 * Who made this and where it lives. Everything the About dialog and the
 * updater need to identify the app, in one place.
 *
 * The version is deliberately NOT here — it comes from `app.getVersion()`,
 * which reads the packaged package.json. Two places to bump is one too many.
 */

export const ABOUT = {
  appName: 'Video Trim & Crop',
  author: 'Darren Ng',

  /** owner/name on github.com. The updater builds every URL from this. */
  repo: 'NGJHD/video-trim-crop-app',

  /**
   * The release asset to prefer when a release carries several. Matched
   * case-insensitively against the end of the filename; the first `.zip`
   * is the fallback. Keep it in step with electron-builder.yml's
   * `artifactName`, which currently ends `-x64.zip`.
   */
  assetSuffix: '-x64.zip',
};

export const repoUrl = `https://github.com/${ABOUT.repo}`;
export const releasesUrl = `${repoUrl}/releases`;
export const latestReleaseApiUrl = `https://api.github.com/repos/${ABOUT.repo}/releases/latest`;
