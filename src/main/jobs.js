import { spawn, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { FFMPEG } from './binaries.js';
import { CH } from '../shared/ipc.js';

/**
 * Every running ffmpeg child, by job id. An orphaned ffmpeg.exe pegging the CPU
 * after the app closes is a shipping blocker, so this map is the single place
 * that knows what to kill — on cancel, on window close and on app quit.
 * @type {Map<string, {child: import('child_process').ChildProcess, outPath: string|null, cancelled: boolean}>}
 */
const jobs = new Map();

const STDERR_TAIL_LINES = 20;

export function newJobId() {
  return randomUUID();
}

/**
 * Kill a child on Windows. child.kill() alone can leave ffmpeg running when it
 * has spawned its own workers, so fall back to taskkill on the process tree.
 */
function hardKill(child) {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  const pid = child.pid;
  if (!pid) return;
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
    }
  }, 1500);
}

/**
 * Run ffmpeg with an argument ARRAY. Never build a shell command string —
 * Windows user paths frequently contain spaces.
 *
 * @param {object}   opts
 * @param {string}   opts.jobId
 * @param {string[]} opts.args
 * @param {string}   opts.stage
 * @param {number}   [opts.totalSeconds]  Enables progress parsing when set.
 * @param {string}   [opts.outPath]       Deleted if the job is cancelled or fails.
 * @param {Electron.WebContents} [opts.sender]
 * @returns {Promise<{jobId: string, outPath: string|null}>}
 */
export function runFfmpeg({ jobId, args, stage, totalSeconds, outPath = null, sender }) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    jobs.set(jobId, { child, outPath, cancelled: false });

    const stderrTail = [];
    let stdoutBuf = '';
    const startedAt = Date.now();
    let lastPercent = 0;

    // Progress comes from -progress pipe:1 on STDOUT as key=value lines.
    // The human-readable stderr status line is unstable across versions and is
    // never parsed — see CLAUDE.md section 8.
    child.stdout.on('data', (chunk) => {
      if (!totalSeconds || !sender || sender.isDestroyed()) return;
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';

      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();

        let seconds = null;
        if (key === 'out_time_us' || key === 'out_time_ms') {
          // out_time_ms is microseconds in several ffmpeg versions. Prefer
          // out_time_us and treat both as microseconds.
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0) seconds = n / 1_000_000;
        } else if (key === 'out_time') {
          const m = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (m) seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        }
        if (seconds === null) continue;

        const percent = Math.max(0, Math.min(100, (seconds / totalSeconds) * 100));
        if (percent < lastPercent) continue;
        lastPercent = percent;

        // ETA from measured throughput, not a hardcoded constant — machines
        // vary several-fold. Suppressed early so it doesn't flash a wild number.
        const elapsed = (Date.now() - startedAt) / 1000;
        let etaSeconds;
        if (elapsed > 3 && percent > 1) {
          etaSeconds = Math.max(0, (elapsed / percent) * (100 - percent));
        }
        sender.send(CH.JOB_PROGRESS, { jobId, stage, percent, etaSeconds });
      }
    });

    child.stderr.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    });

    child.on('error', (err) => {
      jobs.delete(jobId);
      reject(Object.assign(new Error(`Could not start FFmpeg: ${err.message}`), {
        ffmpegTail: stderrTail.join('\n'),
      }));
    });

    child.on('close', (code) => {
      const entry = jobs.get(jobId);
      const cancelled = entry?.cancelled ?? false;
      jobs.delete(jobId);

      if (cancelled) {
        removeIfExists(outPath);
        reject(Object.assign(new Error('Cancelled'), { cancelled: true, ffmpegTail: '' }));
        return;
      }
      if (code !== 0) {
        removeIfExists(outPath);
        // Most FFmpeg problems are diagnosable only from stderr, so the tail
        // travels with the error rather than being swallowed.
        reject(
          Object.assign(new Error(`FFmpeg exited with code ${code}`), {
            ffmpegTail: stderrTail.join('\n'),
          })
        );
        return;
      }
      if (sender && !sender.isDestroyed() && totalSeconds) {
        sender.send(CH.JOB_PROGRESS, { jobId, stage, percent: 100 });
      }
      resolve({ jobId, outPath });
    });
  });
}

function removeIfExists(p) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* best effort */
  }
}

/** Cancel one job. Its partial output file is deleted by the close handler. */
export function cancelJob(jobId) {
  const entry = jobs.get(jobId);
  if (!entry) return false;
  entry.cancelled = true;
  hardKill(entry.child);
  return true;
}

/** Kill everything. Called on window close and on app quit. */
export function cancelAllJobs() {
  for (const [, entry] of jobs) {
    entry.cancelled = true;
    hardKill(entry.child);
  }
  jobs.clear();
}

export function hasRunningJobs() {
  return jobs.size > 0;
}
