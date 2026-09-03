import { app, net } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ABOUT, latestReleaseApiUrl, repoUrl, releasesUrl } from '../shared/about.js';
import { isNewer, pickReleaseAsset } from '../shared/version.js';

/**
 * Self-update against GitHub Releases.
 *
 * The shipped app is a zip of a folder the user unzipped somewhere, so an
 * update is: download the newest release zip, unpack it in temp, then hand the
 * folder to a small script that waits for this process to exit, copies the new
 * files over the install folder, and starts the app again. A running exe cannot
 * overwrite itself, which is the whole reason the script exists.
 *
 * Nothing here touches the registry and nothing is installed. If the copy
 * fails, the old install is still there and still runs.
 */

/** Staging folders survive a power cut, so they carry a prefix we can sweep. */
const STAGING_PREFIX = 'vtc-update-';

/** Anonymous GitHub API calls are capped at 60/hour per IP. A button never gets near that. */
const API_TIMEOUT_MS = 20000;

/** AbortController for the download in flight, so a 250 MB fetch is cancellable. */
let inFlight = null;

/* ------------------------------------------------------------------ identity */

/** Everything the About dialog shows. */
export function aboutInfo() {
  return {
    appName: ABOUT.appName,
    author: ABOUT.author,
    version: app.getVersion(),
    repoUrl,
    releasesUrl,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    // A dev run lives in node_modules/electron — there is nothing to replace.
    canInstall: app.isPackaged,
    installFolder: installFolder(),
  };
}

/** The exe on disk, and the folder holding it. */
function installExePath() {
  return process.execPath;
}

function installFolder() {
  return path.dirname(installExePath());
}

/* --------------------------------------------------------------------- check */

function apiHeaders() {
  return {
    // GitHub answers a missing User-Agent with a bare 403 and no explanation.
    'User-Agent': `VideoTrimCrop-Updater/${app.getVersion()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Ask GitHub what the newest published release is. Returns it whether or not
 * it is newer, so the caller can say "you are on the latest" and mean it.
 */
export async function checkForUpdate() {
  sweepAbandonedStaging();

  const current = app.getVersion();

  let res;
  try {
    res = await net.fetch(latestReleaseApiUrl, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      err?.name === 'TimeoutError'
        ? 'GitHub did not answer in time. Check the network connection.'
        : 'Could not reach GitHub. Check the network connection.'
    );
  }

  if (!res.ok) {
    // 404 covers both "no such repo" and "no release published yet", and the
    // second is the one anyone is actually likely to hit.
    if (res.status === 404) throw new Error('No release has been published yet.');
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub is rate limiting this connection. Try again in an hour.');
    }
    throw new Error(`GitHub returned HTTP ${res.status}.`);
  }

  const release = await res.json();
  const tag = release?.tag_name;
  if (!tag) throw new Error('The latest release has no tag.');

  const asset = pickReleaseAsset(release.assets, ABOUT.assetSuffix);
  if (!asset) throw new Error(`Release ${tag} has no .zip attached to it.`);

  return {
    current,
    tag,
    // The tag is the version. Strip the v so the UI never shows "vv1.2.0".
    version: String(tag).replace(/^[vV]/, ''),
    newer: isNewer(tag, current),
    assetName: asset.name,
    assetSize: Number(asset.size) || 0,
    downloadUrl: asset.browser_download_url,
    notes: typeof release.body === 'string' ? release.body.trim().slice(0, 4000) : '',
    publishedAt: release.published_at || '',
    htmlUrl: release.html_url || releasesUrl,
  };
}

/* ------------------------------------------------------------------- staging */

/**
 * Fail before a 250 MB download rather than after it. An install under
 * Program Files, or on a read-only share, cannot be replaced.
 */
export function isInstallFolderWritable() {
  const probe = path.join(installFolder(), `.${STAGING_PREFIX}probe`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function newStagingDir() {
  const dir = path.join(
    app.getPath('temp'),
    STAGING_PREFIX + crypto.randomUUID().replace(/-/g, '')
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmQuiet(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* a file still held open is not worth failing over */
  }
}

/**
 * A machine that lost power mid-update leaves its staging folder behind, and
 * these hold a whole unpacked app. Nobody goes looking for them, so sweep the
 * old ones every time we check.
 */
function sweepAbandonedStaging() {
  const temp = app.getPath('temp');
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  let entries = [];
  try {
    entries = fs.readdirSync(temp);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const full = path.join(temp, name);
    try {
      if (fs.statSync(full).mtimeMs < dayAgo) rmQuiet(full);
    } catch {
      /* vanished under us; nothing to do */
    }
  }
}

/* ------------------------------------------------------------------ download */

function cancelledError() {
  const err = new Error('Update cancelled.');
  err.cancelled = true;
  return err;
}

/**
 * Abort an in-flight download. The controller is left in place: the download
 * loop reads `signal.aborted` to tell a cancellation from a network failure,
 * and clearing it here would make a cancel report itself as an error.
 */
export function cancelUpdate() {
  inFlight?.abort();
  return true;
}

/**
 * Stream the asset to disk, reporting bytes as they land. Streamed rather than
 * buffered because the zip is ~250 MB — the bundled FFmpeg dominates it.
 */
async function downloadTo(url, destination, assetSize, onBytes) {
  inFlight = new AbortController();

  let res;
  try {
    res = await net.fetch(url, { headers: apiHeaders(), signal: inFlight.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw cancelledError();
    throw new Error('The download could not be started. Check the network connection.');
  }

  if (!res.ok) throw new Error(`The download failed with HTTP ${res.status}.`);

  const total = Number(res.headers.get('content-length')) || assetSize || 0;
  const out = fs.createWriteStream(destination);
  const reader = res.body.getReader();
  let received = 0;
  let lastTick = 0;
  let failure = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.byteLength;
      if (!out.write(Buffer.from(value))) {
        await new Promise((resolve) => out.once('drain', resolve));
      }

      // Throttled: a 250 MB download fires this thousands of times otherwise.
      const now = Date.now();
      if (now - lastTick > 120) {
        lastTick = now;
        onBytes(received, total);
      }
    }
    onBytes(received, total);
  } catch (err) {
    // Recorded, not rethrown from here: the stream still has to be closed, and
    // `end()` on a destroyed stream may never call its callback — which would
    // hang the await below forever. The partial file goes with the staging
    // folder either way.
    failure = inFlight?.signal.aborted || err?.name === 'AbortError' ? cancelledError() : err;
  }

  await new Promise((resolve) => out.end(resolve));
  if (failure) throw failure;
}

/* ------------------------------------------------------------------- extract */

/** Arguments as an array, never a shell string — install paths have spaces. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let tail = '';
    child.stderr.on('data', (d) => { tail = (tail + d).slice(-2000); });
    child.on('error', (err) =>
      reject(new Error(`Could not run ${path.basename(command)}: ${err.message}`))
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Unpacking the download failed (exit ${code}).${tail ? `\n${tail}` : ''}`));
    });
  });
}

/**
 * Unzip without a dependency. Windows 10 1803 and later ship bsdtar as
 * System32\tar.exe, which reads zip perfectly well and is far quicker than
 * PowerShell's Expand-Archive; that stays as the fallback for anything older.
 */
function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });

  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const bsdtar = path.join(systemRoot, 'System32', 'tar.exe');

  if (fs.existsSync(bsdtar)) {
    return run(bsdtar, ['-xf', zipPath, '-C', destination]);
  }

  const quote = (s) => s.replace(/'/g, "''");
  return run(
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${quote(zipPath)}' -DestinationPath '${quote(destination)}' -Force`,
    ]
  );
}

/* -------------------------------------------------------------------- verify */

/**
 * Read `version` out of the package.json inside an asar archive.
 *
 * The format is a 4-byte pickle header, a 4-byte payload size, a 4-byte string
 * length and then the JSON directory; file data begins at 8 + payloadSize.
 * Cheaper and more exact than shelling out for the exe's file version, and it
 * reads the very package.json the new app would run with.
 *
 * @returns {string|null} null when the archive cannot be read — the caller
 *   treats that as "unknown", not as "wrong".
 */
function readAsarVersion(asarPath) {
  let fd;
  try {
    fd = fs.openSync(asarPath, 'r');

    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);

    const payloadSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) return null;

    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);

    const entry = JSON.parse(json.toString('utf8'))?.files?.['package.json'];
    if (!entry) return null;

    const dataStart = 8 + payloadSize;
    const body = Buffer.alloc(Number(entry.size));
    fs.readSync(fd, body, 0, body.length, dataStart + Number(entry.offset));

    return JSON.parse(body.toString('utf8'))?.version ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already gone */ }
    }
  }
}

/**
 * Confirm what came out of the zip is a whole app, and that it really is the
 * version the tag claimed. Cheap, and it catches a hand-uploaded asset that
 * skipped whatever the release process normally checks.
 */
function verifyUnpacked(root, release) {
  const exeName = path.basename(installExePath());

  if (!fs.existsSync(path.join(root, exeName))) {
    throw new Error(`The download does not contain ${exeName}. Nothing has been changed.`);
  }

  const asar = path.join(root, 'resources', 'app.asar');
  if (!fs.existsSync(asar)) {
    throw new Error('The download is missing resources/app.asar. Nothing has been changed.');
  }

  const found = readAsarVersion(asar);
  if (found && found !== release.version) {
    throw new Error(
      `The download reports version ${found}, but release ${release.tag} claims ` +
        `${release.version}. Nothing has been changed.`
    );
  }
}

/** One level down only; a release zip is not a haystack. */
function findAppRoot(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name);
    if (fs.existsSync(path.join(candidate, 'resources', 'app.asar'))) return candidate;
  }
  return null;
}

/**
 * Download, unpack and verify. Returns the folder holding the new app, ready
 * to be copied over the install folder.
 */
export async function downloadAndStage(release, onProgress) {
  const staging = newStagingDir();

  try {
    const zipPath = path.join(staging, release.assetName);

    onProgress({ phase: 'download', percent: 0, received: 0, total: release.assetSize });
    await downloadTo(release.downloadUrl, zipPath, release.assetSize, (received, total) => {
      onProgress({
        phase: 'download',
        percent: total ? Math.min(100, (received / total) * 100) : 0,
        received,
        total,
      });
    });

    // Unpacking reports no progress of its own — bsdtar is quiet and it is over
    // in seconds, so the bar simply sits full while the label changes.
    onProgress({ phase: 'extract', percent: 100, received: 0, total: 0 });

    const unpacked = path.join(staging, 'files');
    await extractZip(zipPath, unpacked);

    // The zip is flat — electron-builder writes win-unpacked's contents with no
    // wrapping folder — but tolerate one in case that ever changes.
    const root = fs.existsSync(path.join(unpacked, 'resources', 'app.asar'))
      ? unpacked
      : findAppRoot(unpacked);
    if (!root) {
      throw new Error('The download does not look like an app folder. Nothing has been changed.');
    }

    verifyUnpacked(root, release);

    // The zip has served its purpose and is a quarter of a gigabyte.
    rmQuiet(zipPath);

    return root;
  } catch (err) {
    rmQuiet(staging);
    throw err;
  } finally {
    inFlight = null;
  }
}

/* --------------------------------------------------------------------- apply */

function buildUpdaterScript({ ready, staging, target, exe }) {
  const log = path.join(target, 'update.log');

  // Everything is baked in rather than passed as arguments: the install folder
  // can sit on a mapped drive with spaces in it, and this way there is no
  // quoting left to get wrong.
  return [
    '@echo off',
    'title Updating Video Trim ^& Crop',
    'rem Written by Video Trim ^& Crop at update time. Safe to delete.',
    'setlocal',
    '',
    `set "READY=${ready}"`,
    `set "STAGE=${staging}"`,
    `set "TARGET=${target}"`,
    `set "EXE=${exe}"`,
    `set "LOG=${log}"`,
    '',
    'echo [%DATE% %TIME%] update starting >>"%LOG%"',
    '',
    'rem Wait until the exe stops being locked. That is the real precondition',
    'rem for replacing it, and it stays true a moment longer than the process',
    'rem does while antivirus lets go. Opening it for append writes nothing.',
    'rem',
    'rem Deliberately NOT `tasklist | find`: that pipeline left a find.exe hung',
    'rem on its pipe when the parent went away, and the update never ran.',
    'set /a TRIES=0',
    ':waitloop',
    '2>nul (>>"%EXE%" call ) && goto exited',
    'set /a TRIES+=1',
    'if %TRIES% GEQ 60 (',
    '  echo [%DATE% %TIME%] app still holding its exe after 60s - nothing replaced >>"%LOG%"',
    '  goto restart',
    ')',
    'ping -n 2 127.0.0.1 >nul',
    'goto waitloop',
    '',
    ':exited',
    'robocopy "%READY%" "%TARGET%" /E /R:3 /W:2 /NFL /NDL /NJH /NJS /NP >>"%LOG%" 2>&1',
    'rem robocopy exits 0-7 for success; 8 and above is a real failure.',
    'if errorlevel 8 (',
    '  echo [%DATE% %TIME%] robocopy failed - the install may be incomplete >>"%LOG%"',
    ') else (',
    '  echo [%DATE% %TIME%] update applied >>"%LOG%"',
    ')',
    '',
    ':restart',
    staging ? 'rd /s /q "%STAGE%" 2>nul' : 'rem the staging folder was not ours; left alone',
    'start "" /D "%TARGET%" "%EXE%"',
    'exit /b 0',
    '',
  ].join('\r\n');
}

/**
 * The running exe cannot overwrite itself, so hand the replacement to a script,
 * quit, and let it start us again.
 *
 * robocopy rather than xcopy: it retries a locked file instead of giving up,
 * and it skips files whose size and timestamp already match — which means the
 * 290 MB of unchanged FFmpeg binaries are not copied at all. Extraneous files
 * are left alone (no /MIR): deleting things out of the user's own folder to
 * save a few megabytes is not a trade worth making.
 */
export function launchUpdaterAndQuit(readyFolder) {
  const staging = path.dirname(readyFolder);
  const target = installFolder();
  const exe = installExePath();
  const scriptPath = path.join(
    app.getPath('temp'),
    `${STAGING_PREFIX}${crypto.randomUUID().replace(/-/g, '')}.cmd`
  );

  // The script ends by deleting the staging folder. Only ever hand it one we
  // made ourselves — pointed anywhere else that line takes a real folder.
  const stagingIsOurs = path.basename(staging).startsWith(STAGING_PREFIX);

  try {
    fs.writeFileSync(
      scriptPath,
      buildUpdaterScript({
        ready: readyFolder,
        staging: stagingIsOurs ? staging : '',
        target,
        exe,
      }),
      'utf8'
    );

    // Through cmd.exe, not the .cmd directly: since the CVE-2024-27980 fix,
    // Node refuses to spawn a .bat or .cmd as the executable and answers
    // EINVAL. cmd.exe is a real exe and the script path stays a separate
    // argv entry, so a profile path with a space in it survives.
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: app.getPath('temp'),
    });
    // Without a listener an async spawn failure is an uncaught exception. By
    // the time one could arrive the app is already quitting, so there is
    // nothing to do but not crash on the way out.
    child.on('error', () => {});
    child.unref();
  } catch (err) {
    // Nothing has been replaced, so leave no 700 MB folder behind either.
    if (stagingIsOurs) rmQuiet(staging);
    rmQuiet(scriptPath);
    throw new Error(`The update could not be started: ${err.message}. Nothing has been changed.`);
  }
}
