/**
 * FFmpeg filter chain construction. Kept free of Electron imports so it can be
 * exercised directly by the checks in scripts/verify.mjs.
 */

import { QUALITY, DEFAULT_QUALITY } from './ipc.js';

/**
 * HDR to SDR tone-map. Only ever applied when ffprobe reported an HDR transfer
 * (arib-std-b67 or smpte2084) — running it on BT.709 input degrades the image
 * for no reason. See CLAUDE.md section 7.1.
 */
export const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
  'tonemap=tonemap=hable:desat=0,' +
  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/**
 * Manual rotation, in degrees CLOCKWISE.
 *
 * This is NOT the auto-rotation of the display matrix — FFmpeg still does that
 * for us, ahead of every user filter. This is the separate, user-driven
 * correction for footage whose phone wrote the wrong matrix (CLAUDE.md 6.1).
 *
 * Directions verified against real footage: transpose=1 moves a top-left marker
 * to the top-right (90 clockwise), transpose=2 moves it to the bottom-left.
 */
export function rotateFilter(degrees) {
  switch (((degrees % 360) + 360) % 360) {
    case 90: return 'transpose=1';
    case 180: return 'hflip,vflip';
    case 270: return 'transpose=2';
    default: return null;
  }
}

/**
 * Build the -vf chain for the final render.
 *
 * Order is deliberate and load-bearing:
 *   1. rotate  — so everything after it sees the frame the user sees
 *   2. crop    — coordinates are in that same rotated display space
 *   3. tonemap — cheapest last, on the fewest pixels
 *
 * @param {{crop: {x:number,y:number,w:number,h:number}|null, isHDR: boolean, rotation?: number}} opts
 * @returns {string|null} null when no -vf is needed at all
 */
export function buildRenderFilters({ crop, isHDR, rotation = 0 }) {
  const parts = [];
  const rot = rotateFilter(rotation);
  if (rot) parts.push(rot);
  if (crop) parts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  if (isHDR) parts.push(TONEMAP);
  return parts.length ? parts.join(',') : null;
}

/**
 * Filmstrip thumbnails match the player: same rotation, and tone-mapped for HDR
 * so the strip doesn't sit next to the video looking washed out.
 */
export function buildThumbFilters({ isHDR, height, rotation = 0 }) {
  const parts = [];
  const rot = rotateFilter(rotation);
  if (rot) parts.push(rot);
  if (isHDR) parts.push(TONEMAP);
  parts.push(`scale=-2:${height}`);
  return parts.join(',');
}

/**
 * Full argument array for the final render. Never a shell command string —
 * Windows user paths frequently contain spaces.
 *
 * -t not -to, because with -ss before -i the semantics of -to have changed
 * across FFmpeg versions and duration is unambiguous.
 *
 * @param {import('./ipc.js').ProcessRequest} req
 */
export function buildRenderArgs(req) {
  const q = QUALITY[req.quality] || QUALITY[DEFAULT_QUALITY];
  const filters = buildRenderFilters({
    crop: req.crop,
    isHDR: req.isHDR,
    rotation: req.rotation,
  });

  const args = ['-y', '-v', 'error', '-ss', String(req.start), '-i', req.srcPath, '-t', String(req.duration)];
  if (filters) args.push('-vf', filters);

  args.push('-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf, '-pix_fmt', 'yuv420p');

  if (req.removeAudio) {
    args.push('-an');
  } else if (req.hasAudio) {
    // Audio is re-encoded, not copied: copying across an arbitrary trim point
    // causes small A/V sync offsets because audio frames don't align to the cut.
    args.push('-c:a', 'aac', '-b:a', q.audioBitrate);
  }
  // Source with no audio gets no audio flags at all.

  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', req.outPath);
  return args;
}
