import path from 'path';
import fs from 'fs';
import { runFfmpeg, newJobId } from './jobs.js';
import { tempDir, hashPath } from './temp.js';
import { STAGE, TIER } from '../shared/ipc.js';
import { buildFilmstripArgs, buildRenderArgs } from '../shared/filters.js';


/**
 * Tier 2 — container rewrite. No decode, no encode; runs at disk speed.
 */
export async function remuxProxy({ srcPath, sender }) {
  const out = path.join(tempDir(), `proxy_${hashPath(srcPath)}.mp4`);
  const jobId = newJobId();
  await runFfmpeg({
    jobId,
    stage: STAGE.REMUX,
    outPath: out,
    sender,
    args: ['-y', '-v', 'error', '-i', srcPath, '-c', 'copy', '-movflags', '+faststart',
           '-progress', 'pipe:1', '-nostats', out],
  });
  return { path: out, tier: TIER.REMUX };
}

/**
 * Tier 3 — preview transcode. Preview only: this file is never an input to the
 * final render. -hwaccel auto is safe here for the same reason, and the short
 * GOP keeps scrubbing responsive.
 */
export async function transcodeProxy({ srcPath, duration, sender }) {
  const out = path.join(tempDir(), `proxy_${hashPath(srcPath)}.mp4`);
  const jobId = newJobId();
  await runFfmpeg({
    jobId,
    stage: STAGE.TRANSCODE,
    totalSeconds: duration,
    outPath: out,
    sender,
    args: [
      '-y', '-v', 'error',
      '-hwaccel', 'auto',
      '-i', srcPath,
      '-vf', 'scale=-2:720',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      out,
    ],
  });
  return { path: out, tier: TIER.TRANSCODE };
}

/**
 * Build the filmstrip in ONE ffmpeg pass.
 *
 * The first version spawned one process per thumbnail, each seeking
 * independently. That re-opened and re-demuxed the file N times and cost about
 * 10 s for a 2-minute HEVC clip. A single pass with `-skip_frame nokey` does
 * the same strip in about 1 s, because the decoder skips everything that isn't
 * a keyframe and the file is opened once. See CLAUDE.md section 5.4.
 *
 * Failure is non-fatal to the caller: the timeline falls back to a plain track.
 */
export async function buildFilmstrip({ srcPath, duration, count, height, isHDR, rotation = 0, jobId, sender }) {
  // The key covers everything that changes the pixels or the sample times.
  const dir = path.join(tempDir(), `strip_${hashPath(srcPath)}_r${rotation}_n${count}_h${height}`);
  // ffmpeg decides how many frames come out (it lands on keyframes), so a
  // marker file records completion rather than counting expected files.
  const marker = path.join(dir, 'complete');

  const listFrames = () =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .map((f) => path.join(dir, f));

  if (fs.existsSync(marker)) return listFrames();

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  try {
    await runFfmpeg({
      jobId,
      stage: STAGE.FILMSTRIP,
      totalSeconds: duration,
      sender,
      args: buildFilmstripArgs({
        srcPath,
        outPattern: path.join(dir, 't%04d.jpg'),
        duration,
        count,
        height,
        isHDR,
        rotation,
      }),
    });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  const frames = listFrames();
  // Only cache a strip that actually produced something, so an odd file gets
  // retried rather than remembered as empty.
  if (frames.length) fs.writeFileSync(marker, '');
  return frames;
}

/**
 * The final render. Always reads the ORIGINAL file — any code path that
 * renders from a proxy is a bug (CLAUDE.md section 5.3).
 *
 * -t not -to, because with -ss before -i the semantics of -to have changed
 * across FFmpeg versions and duration is unambiguous.
 */
export async function renderOutput({ req, jobId, sender }) {
  const args = buildRenderArgs(req);

  await runFfmpeg({
    jobId,
    stage: STAGE.RENDER,
    totalSeconds: req.duration,
    outPath: req.outPath,
    sender,
    args,
  });
  return req.outPath;
}
