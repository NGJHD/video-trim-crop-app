import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Resolve the bundled FFmpeg binaries.
 *
 * Inside a packaged app these land in resources/bin next to app.asar, because
 * electron-builder's extraResources copies them there. Files inside an asar
 * archive cannot be executed, which is why this rewrite exists and why the
 * binaries are also listed under asarUnpack. This works in dev and breaks only
 * after packaging, so it is easy to miss — see CLAUDE.md section 9.
 *
 * Never resolve these from the system PATH.
 */
function resolveBin(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', name)
    : path.join(__dirname, '../../resources/bin', name);
}

export const FFMPEG = resolveBin('ffmpeg.exe');
export const FFPROBE = resolveBin('ffprobe.exe');

/**
 * Window icon. The packaged exe already carries this icon in its resources, so
 * Explorer and the taskbar get it for free — but a dev run launches
 * electron.exe, which would otherwise show the stock Electron logo. Pointing
 * the BrowserWindow at the file makes both look the same.
 */
export const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '../../build/icon.ico');

/** The icon is cosmetic: missing it must never stop the app starting. */
export function iconPathIfPresent() {
  return fs.existsSync(ICON) ? ICON : undefined;
}

/**
 * Assert both binaries exist before the window opens. Failing loudly here is
 * far better than a cryptic ENOENT on the user's first drop.
 * @returns {boolean} true if both are present
 */
export function assertBinaries() {
  const missing = [
    ['ffmpeg.exe', FFMPEG],
    ['ffprobe.exe', FFPROBE],
  ].filter(([, p]) => !fs.existsSync(p));

  if (missing.length === 0) return true;

  const list = missing.map(([n, p]) => `  ${n}\n    expected at: ${p}`).join('\n');
  dialog.showErrorBox(
    'Video Trim & Crop cannot start',
    `The bundled FFmpeg binaries are missing:\n\n${list}\n\n` +
      `This app never uses FFmpeg from the system PATH — the binaries ship with it. ` +
      `Reinstall the app, or in a development checkout copy ffmpeg.exe and ffprobe.exe ` +
      `into resources/bin/.`
  );
  return false;
}
