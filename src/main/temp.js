import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DIR_NAME = 'video-trim-crop';

export function tempDir() {
  const dir = path.join(app.getPath('temp'), DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Short stable hash of a path, so re-importing the same file reuses names. */
export function hashPath(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 12);
}

/**
 * Delete everything in the temp directory. Called at startup (to catch what a
 * crash left behind), when a new file is loaded, and on quit. Do not leak
 * gigabytes into the user's temp folder.
 */
export function sweepTemp() {
  const dir = path.join(app.getPath('temp'), DIR_NAME);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    try {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    } catch {
      // A file still held open by a dying ffmpeg is not worth failing over.
    }
  }
}

/**
 * Pick an output path that does not overwrite anything: name_trimmed.mp4, then
 * name_trimmed_1.mp4, and so on.
 */
export function suggestOutputPath(srcPath) {
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath, path.extname(srcPath));
  let candidate = path.join(dir, `${base}_trimmed.mp4`);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_trimmed_${n}.mp4`);
    n += 1;
  }
  return candidate;
}
