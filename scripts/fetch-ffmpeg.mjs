/**
 * Download the FFmpeg binaries this app bundles, into resources/bin/.
 *
 * They are not in git and cannot be: ffmpeg.exe and ffprobe.exe are ~212 MB
 * each, and GitHub hard-rejects any file over 100 MB. End users never need
 * this — the released zip already contains them. This is for a source clone.
 *
 *   npm run fetch-ffmpeg
 *
 * Downloads a GPL build (x264 enabled, which the render spec requires),
 * verifies it can actually do everything the app needs, and only then moves it
 * into place. A build missing zscale/tonemap would break HDR output in a way
 * that is easy to miss, so that is checked rather than assumed.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'resources', 'bin');

// BtbN publishes static win64 GPL builds as a plain .zip, which Windows can
// extract without any extra tool. `latest` always resolves to a current build.
const URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

/** Filters and encoders the app depends on. Missing any of these is fatal. */
const REQUIRED = ['libx264', 'zscale', 'tonemap', 'aac'];

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

if (process.platform !== 'win32') {
  console.error('This app is Windows-only; these are win64 binaries.');
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vtc-ffmpeg-'));
const zipPath = path.join(work, 'ffmpeg.zip');

try {
  console.log(`Downloading ${URL}`);
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let seen = 0;
  let lastPrint = 0;
  const out = fs.createWriteStream(zipPath);
  for await (const chunk of res.body) {
    out.write(chunk);
    seen += chunk.length;
    if (Date.now() - lastPrint > 500) {
      lastPrint = Date.now();
      process.stdout.write(
        `\r  ${mb(seen)}${total ? ` of ${mb(total)} (${((seen / total) * 100).toFixed(0)}%)` : ''}   `
      );
    }
  }
  await new Promise((r) => out.end(r));
  console.log(`\r  downloaded ${mb(seen)}                    `);

  console.log('Extracting…');
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${work}' -Force`],
    { stdio: 'inherit' }
  );

  // The archive nests everything under one versioned directory.
  const found = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'ffmpeg.exe' || entry.name === 'ffprobe.exe') found[entry.name] = full;
    }
  };
  walk(work);

  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    if (!found[name]) throw new Error(`${name} was not in the archive`);
  }

  // Verify BEFORE replacing anything that currently works.
  console.log('Verifying the build has what the app needs…');
  const version = execFileSync(found['ffmpeg.exe'], ['-version'], { encoding: 'utf8' }).split('\n')[0];
  const filters = execFileSync(found['ffmpeg.exe'], ['-hide_banner', '-filters'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const encoders = execFileSync(found['ffmpeg.exe'], ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const haystack = `${filters}\n${encoders}`;

  const missing = REQUIRED.filter((r) => !haystack.includes(r));
  if (missing.length) {
    throw new Error(
      `This build is missing: ${missing.join(', ')}.\n` +
        `The app needs libx264 for output and zscale/tonemap for HDR sources.\n` +
        `Nothing was changed — resources/bin/ is untouched.`
    );
  }

  fs.mkdirSync(BIN, { recursive: true });
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    fs.copyFileSync(found[name], path.join(BIN, name));
  }

  console.log(`\n${version}`);
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    console.log(`  resources/bin/${name}  ${mb(fs.statSync(path.join(BIN, name)).size)}`);
  }
  console.log('\nGPL build — see THIRD-PARTY-NOTICES.md before distributing.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
