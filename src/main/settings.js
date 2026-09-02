import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { pickStartFolder } from '../shared/folder.js';

/**
 * A tiny persisted settings file. Deliberately not a dependency — there is one
 * value to remember and losing it is harmless.
 *
 * Lives in userData, which for the zip build is under %APPDATA%. That is the
 * one thing the app writes outside its own folder; nothing else persists.
 */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) ?? {};
  } catch {
    // Missing or corrupt: start fresh rather than failing to launch.
    return {};
  }
}

function write(next) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch {
    // Settings are a convenience; a read-only profile must not break the app.
  }
}

/** Remember the folder a video was opened from. */
export function rememberFolder(folder) {
  if (!folder) return;
  write({ ...read(), lastFolder: folder });
}

/** fs-backed existence check for the policy in shared/folder.js. */
function isDirectory(p) {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Where the open dialog should start. */
export function startFolder() {
  let desktop = '';
  let home = '';
  try {
    desktop = app.getPath('desktop');
  } catch {
    /* some profiles have no Desktop */
  }
  try {
    home = app.getPath('home');
  } catch {
    /* nothing sensible left; the dialog will pick its own default */
  }
  return pickStartFolder(read().lastFolder, desktop, home, isDirectory);
}
