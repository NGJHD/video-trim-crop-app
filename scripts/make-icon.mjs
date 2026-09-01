/**
 * Build build/icon.ico from build/icon.png.
 *
 * electron-builder will accept a PNG and convert it, but it produces a single
 * size. Windows picks different resolutions for the taskbar, alt-tab, Explorer
 * tiles and the exe's own thumbnail, so a real multi-resolution .ico looks
 * correct everywhere instead of being a blurry rescale in most places.
 *
 * ICO is a simple container: a header, one 16-byte directory entry per image,
 * then the image payloads. Vista and later accept PNG payloads directly, which
 * is what we write.
 *
 *   node scripts/make-icon.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = path.join(root, 'resources', 'bin', 'ffmpeg.exe');
const SOURCE = path.join(root, 'build', 'icon.png');
const OUTPUT = path.join(root, 'build', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

if (!fs.existsSync(SOURCE)) {
  console.error(`Missing ${SOURCE}. Put a square PNG (1024x1024 ideally) there first.`);
  process.exit(1);
}
if (!fs.existsSync(FFMPEG)) {
  console.error(`Missing ${FFMPEG}. See the README on bundled binaries.`);
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vtc-icon-'));

const images = SIZES.map((size) => {
  const out = path.join(work, `${size}.png`);
  execFileSync(FFMPEG, [
    '-y', '-v', 'error', '-i', SOURCE,
    // Lanczos keeps the small sizes crisp; the alpha channel must survive.
    '-vf', `scale=${size}:${size}:flags=lanczos`,
    '-pix_fmt', 'rgba',
    '-frames:v', '1', out,
  ]);
  return { size, data: fs.readFileSync(out) };
});

const HEADER = 6;
const ENTRY = 16;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // 1 = icon
header.writeUInt16LE(images.length, 4);

let offset = HEADER + ENTRY * images.length;
const entries = [];
for (const img of images) {
  const e = Buffer.alloc(ENTRY);
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // 0 means 256
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
  e.writeUInt8(0, 2);                    // palette size, 0 for truecolour
  e.writeUInt8(0, 3);                    // reserved
  e.writeUInt16LE(1, 4);                 // colour planes
  e.writeUInt16LE(32, 6);                // bits per pixel
  e.writeUInt32LE(img.data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.data.length;
  entries.push(e);
}

fs.writeFileSync(OUTPUT, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
fs.rmSync(work, { recursive: true, force: true });

console.log(
  `Wrote ${path.relative(root, OUTPUT)} — ${images.length} sizes ` +
  `(${SIZES.join(', ')}), ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB`
);
