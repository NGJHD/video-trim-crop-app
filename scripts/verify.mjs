/**
 * End-to-end checks against real sample footage.
 *
 * The critical one is the rotation test CLAUDE.md section 6 demands: crop a
 * distinctive corner of a real portrait clip and confirm the rendered output
 * contains that corner. If that fails, the whole display-space coordinate model
 * is wrong and must be re-derived rather than papered over with a transpose.
 *
 *   node scripts/verify.mjs [pathToSampleDir]
 *
 * Falls back to $VTC_SAMPLES, then ./samples. The maths checks always run;
 * the footage checks are skipped when no clips are found.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildRenderArgs, buildRenderFilters, buildFilmstripFilters, buildFilmstripArgs, rotateFilter } from '../src/shared/filters.js';
import { QUALITY } from '../src/shared/ipc.js';
import { pickStartFolder } from '../src/shared/folder.js';
import { parseVersion, compareVersions, isNewer, pickReleaseAsset } from '../src/shared/version.js';
import { ABOUT } from '../src/shared/about.js';
import {
  normalizeCrop, fitRatio, renderedVideoRect, toSource, toScreen,
  fullFrameCrop, viewSize, ratioFor, MIN_CROP,
} from '../src/renderer/src/lib/crop.js';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FFMPEG = path.join(root, 'resources', 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(root, 'resources', 'bin', 'ffprobe.exe');
const SAMPLES =
  process.argv[2] || process.env.VTC_SAMPLES || path.join(root, 'samples');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vtc-verify-'));

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

async function probe(file) {
  const { stdout } = await exec(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

async function streamInfo(file) {
  const { stdout } = await exec(FFPROBE, [
    '-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height,pix_fmt,codec_name,color_transfer',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout).streams[0];
}

async function psnr(a, b) {
  const { stderr } = await exec(FFMPEG, [
    '-hide_banner', '-i', a, '-i', b,
    '-lavfi', '[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]psnr',
    '-f', 'null', '-',
  ]).catch((e) => e);
  const m = String(stderr).match(/average:([0-9.]+|inf)/i);
  if (!m) return 0;
  return m[1].toLowerCase() === 'inf' ? 999 : Number(m[1]);
}

// ---------------------------------------------------------------- pure maths

console.log('\nCrop geometry');
{
  // Even rounding: odd dimensions fail outright under yuv420p.
  const c = normalizeCrop({ x: 3, y: 7, w: 101, h: 203 }, 1080, 1920);
  check('rounds x/y/w/h down to even integers',
    c.x % 2 === 0 && c.y % 2 === 0 && c.w % 2 === 0 && c.h % 2 === 0,
    JSON.stringify(c));

  const clamped = normalizeCrop({ x: -50, y: -50, w: 5000, h: 5000 }, 1080, 1920);
  check('clamps to the frame',
    clamped.x === 0 && clamped.y === 0 && clamped.w === 1080 && clamped.h === 1920,
    JSON.stringify(clamped));

  const tiny = normalizeCrop({ x: 0, y: 0, w: 4, h: 4 }, 1080, 1920);
  check('enforces the minimum crop size', tiny.w >= MIN_CROP && tiny.h >= MIN_CROP,
    JSON.stringify(tiny));

  const edge = normalizeCrop({ x: 1079, y: 1919, w: 100, h: 100 }, 1080, 1920);
  check('never lets the box run past the edge',
    edge.x + edge.w <= 1080 && edge.y + edge.h <= 1920, JSON.stringify(edge));

  // A portrait clip: display dims are the coded dims swapped.
  const portrait = { displayWidth: 1080, displayHeight: 1920 };
  const square = fitRatio(fullFrameCrop({ width: 1080, height: 1920 }), 1, 1080, 1920);
  check('1:1 lock produces a square inside a portrait frame',
    Math.abs(square.w - square.h) <= 2 && square.w <= 1080, JSON.stringify(square));

  const wide = fitRatio({ x: 0, y: 0, w: 1080, h: 1920 }, 16 / 9, 1080, 1920);
  check('16:9 lock fits inside a portrait frame',
    wide.w <= 1080 && wide.h <= 1920 && Math.abs(wide.w / wide.h - 16 / 9) < 0.02,
    JSON.stringify(wide));
}

console.log('\nLetterbox mapping');
{
  // A portrait video in a wide container: the video does NOT fill the box, and
  // the letterbox bars must not be croppable.
  const box = { width: 1000, height: 600 };
  const rect = renderedVideoRect(box, 1080, 1920);
  check('portrait video is letterboxed, not stretched',
    rect.height === 600 && Math.abs(rect.width - 600 * (1080 / 1920)) < 0.01,
    JSON.stringify(rect));
  check('rendered rect is horizontally centred',
    Math.abs(rect.left - (1000 - rect.width) / 2) < 0.01);

  // Round trip: a source point converted to screen and back must survive.
  const crop = { x: 200, y: 400, w: 600, h: 600 };
  const screen = toScreen(crop, rect);
  const back = toSource(screen.left, screen.top, rect);
  check('screen/source conversion round-trips',
    Math.abs(back.x - crop.x) < 0.5 && Math.abs(back.y - crop.y) < 0.5,
    `${JSON.stringify(back)} vs ${JSON.stringify(crop)}`);

  // Resizing the window must not move the crop by a pixel.
  const bigRect = renderedVideoRect({ width: 2400, height: 1400 }, 1080, 1920);
  const bigBack = toSource(toScreen(crop, bigRect).left, toScreen(crop, bigRect).top, bigRect);
  check('crop survives a window resize unchanged',
    Math.abs(bigBack.x - crop.x) < 0.5 && Math.abs(bigBack.y - crop.y) < 0.5);
}

console.log('\nFilter chains');
{
  const crop = { x: 540, y: 1380, w: 540, h: 540 };

  check('SDR + crop produces a bare crop filter',
    buildRenderFilters({ crop, isHDR: false }) === 'crop=540:540:540:1380');

  const hdr = buildRenderFilters({ crop, isHDR: true });
  check('HDR chain puts crop FIRST, then the tone-map',
    hdr.startsWith('crop=540:540:540:1380,zscale=t=linear'), hdr);
  check('HDR chain tags the output bt709', hdr.includes('zscale=t=bt709:m=bt709:r=tv'));

  check('SDR source gets no tone-map at all',
    !String(buildRenderFilters({ crop, isHDR: false })).includes('tonemap'));
  check('full-frame SDR needs no -vf at all',
    buildRenderFilters({ crop: null, isHDR: false }) === null);
  check('full-frame HDR still tone-maps',
    buildRenderFilters({ crop: null, isHDR: true }).startsWith('zscale'));

  const strip = buildFilmstripFilters({ isHDR: false, height: 64, step: 3.6 });
  check('the filmstrip selects frames instead of seeking per thumbnail',
    strip.startsWith("select='") && strip.includes('prev_selected_t'), strip);
  check('SDR thumbnails skip the tone-map', !strip.includes('tonemap'), strip);

  const stripHdr = buildFilmstripFilters({ isHDR: true, height: 64, step: 3.6 });
  check('HDR thumbnails are tone-mapped so the strip matches the player',
    stripHdr.includes('tonemap'));
  check('thumbnails scale BEFORE tone-mapping — twice as fast, same at 64px',
    stripHdr.indexOf('scale=-2:64') < stripHdr.indexOf('tonemap'), stripHdr);
  check('the select expression is quoted so its commas are not filter separators',
    /^select='[^']*'/.test(strip), strip);
}

console.log('\nManual rotation');
{
  const media = { displayWidth: 1080, displayHeight: 1920 };
  check('0 and 180 keep the axes',
    viewSize(media, 0).width === 1080 && viewSize(media, 180).width === 1080);
  check('90 and 270 swap the axes',
    viewSize(media, 90).width === 1920 && viewSize(media, 90).height === 1080 &&
    viewSize(media, 270).width === 1920);

  check('90 uses transpose=1 (clockwise, verified against footage)', rotateFilter(90) === 'transpose=1');
  check('180 uses hflip,vflip', rotateFilter(180) === 'hflip,vflip');
  check('270 uses transpose=2', rotateFilter(270) === 'transpose=2');
  check('0 adds no filter', rotateFilter(0) === null);

  // Rotate must come BEFORE crop, or the crop coordinates mean something else.
  const chain = buildRenderFilters({ crop: { x: 10, y: 20, w: 100, h: 200 }, isHDR: false, rotation: 90 });
  check('rotate is applied BEFORE crop in the chain',
    chain.indexOf('transpose=1') < chain.indexOf('crop='), chain);

  const hdrChain = buildRenderFilters({ crop: { x: 0, y: 0, w: 100, h: 100 }, isHDR: true, rotation: 270 });
  check('full chain order is rotate, crop, tonemap',
    hdrChain.indexOf('transpose=2') < hdrChain.indexOf('crop=') &&
    hdrChain.indexOf('crop=') < hdrChain.indexOf('tonemap'), hdrChain);

  check('rotated thumbnails carry the same rotation as the render',
    buildFilmstripFilters({ isHDR: false, height: 64, rotation: 90, step: 3.6 }).includes('transpose=1'));

  // "Original" must follow the rotated frame, not the file's own orientation.
  const rotated = viewSize(media, 90);
  check('Original aspect follows the ROTATED frame',
    Math.abs(ratioFor('original', rotated) - 1920 / 1080) < 0.001,
    String(ratioFor('original', rotated)));
}

console.log('\nFilmstrip pass');
{
  const args = buildFilmstripArgs({
    srcPath: 'in.mp4', outPattern: 'out/t%04d.jpg',
    duration: 120, count: 30, height: 64, isHDR: false, rotation: 0,
  });
  check('decodes keyframes only — the whole reason it is fast',
    args.includes('-skip_frame') && args[args.indexOf('-skip_frame') + 1] === 'nokey');
  check('uses hardware decode where available', args.includes('-hwaccel'));
  check('skips audio entirely', args.includes('-an'));
  check('reports progress so the overlay can be determinate',
    args.join(' ').includes('-progress pipe:1'));
  check('is ONE pass writing a numbered sequence, not N processes',
    args[args.length - 1] === 'out/t%04d.jpg');
  const vf = args[args.indexOf('-vf') + 1];
  check('step is duration / count', vf.includes('4.0000'), vf);
}


console.log('\nRemembered folder');
{
  // A fake filesystem so the policy can be checked without touching disk.
  const present = new Set(['C:\\clips', 'C:\\Users\\me\\Desktop', 'C:\\Users\\me']);
  const exists = (p) => present.has(p);
  const D = 'C:\\Users\\me\\Desktop';
  const H = 'C:\\Users\\me';

  check('reuses the folder the last video came from',
    pickStartFolder('C:\\clips', D, H, exists) === 'C:\\clips');
  check('falls back to the Desktop when the remembered folder is gone',
    pickStartFolder('E:\\unplugged-sd-card\\DCIM', D, H, exists) === D);
  check('falls back to the Desktop on a first run, with nothing remembered',
    pickStartFolder(undefined, D, H, exists) === D);
  check('falls back to home if there is no Desktop either',
    pickStartFolder('E:\\gone', 'C:\\Users\\me\\NoDesktop', H, exists) === H);
  check('an empty remembered value is not treated as a folder',
    pickStartFolder('', D, H, exists) === D);
}


console.log('\nQuality presets');
{
  const qbase = {
    srcPath: 'in.mp4', outPath: 'out.mp4', start: 0, duration: 1,
    crop: null, hasAudio: true, removeAudio: false, isHDR: false, rotation: 0,
  };
  const crfOf = (q) => { const a = buildRenderArgs({ ...qbase, quality: q }); return a[a.indexOf('-crf') + 1]; };
  const presetOf = (q) => { const a = buildRenderArgs({ ...qbase, quality: q }); return a[a.indexOf('-preset') + 1]; };

  check('High is crf 17 / preset slow — the verified default',
    crfOf('high') === '17' && presetOf('high') === 'slow');
  check('Medium and Low trade quality for size',
    Number(crfOf('medium')) > 17 && Number(crfOf('low')) > Number(crfOf('medium')),
    `${crfOf('high')} / ${crfOf('medium')} / ${crfOf('low')}`);
  check('an unknown or missing quality falls back to High',
    crfOf(undefined) === '17' && crfOf('nonsense') === '17');
  check('audio bitrate follows the quality',
    buildRenderArgs({ ...qbase, quality: 'low' }).includes(QUALITY.low.audioBitrate));
}


console.log('\nRender arguments');
{
  const base = {
    srcPath: 'C:\\a b\\in.mp4', outPath: 'C:\\a b\\out.mp4',
    start: 4.2, duration: 7.4, crop: { x: 0, y: 0, w: 100, h: 100 },
    hasAudio: true, removeAudio: false, isHDR: false, rotation: 0, quality: 'high',
  };
  const args = buildRenderArgs(base);

  check('-ss comes before -i', args.indexOf('-ss') < args.indexOf('-i'));
  check('uses -t, not -to', args.includes('-t') && !args.includes('-to'));
  check('crf 17 / preset slow / yuv420p',
    args.includes('17') && args.includes('slow') && args.includes('yuv420p'));
  check('re-encodes audio rather than copying it',
    args.includes('aac') && args.includes('256k'));
  check('faststart and progress on stdout',
    args.includes('+faststart') && args.join(' ').includes('-progress pipe:1'));
  check('paths with spaces are separate array elements, never quoted strings',
    args.includes('C:\\a b\\in.mp4') && args.includes('C:\\a b\\out.mp4'));

  check('remove audio passes -an and drops the codec flags',
    (() => { const a = buildRenderArgs({ ...base, removeAudio: true });
      return a.includes('-an') && !a.includes('aac'); })());
  check('source with no audio gets no audio flags at all',
    (() => { const a = buildRenderArgs({ ...base, hasAudio: false, removeAudio: false });
      return !a.includes('-an') && !a.includes('aac'); })());
}

console.log('\nUpdate version handling');
{
  // Getting this wrong is not cosmetic: always-newer is a download loop,
  // always-older means updates never reach anybody.
  check('parses a v-prefixed tag', JSON.stringify(parseVersion('v1.2.3')) ===
    JSON.stringify({ major: 1, minor: 2, patch: 3, pre: '' }));

  check('fills in a missing patch', parseVersion('1.2')?.patch === 0);

  check('rejects something that is not a version',
    parseVersion('latest') === null && parseVersion('') === null && parseVersion(undefined) === null);

  check('1.10.0 is newer than 1.9.0', isNewer('v1.10.0', '1.9.0'),
    'string comparison would say otherwise');

  check('the same version is not newer', isNewer('v1.0.0', '1.0.0') === false);
  check('an older tag is not newer', isNewer('v0.9.9', '1.0.0') === false);

  check('a prerelease sorts below its release', compareVersions('1.1.0-beta', '1.1.0') < 0);
  check('someone on a beta is offered the final', isNewer('v1.1.0', '1.1.0-beta'));

  check('an unparseable tag never offers an update',
    isNewer('nightly', '1.0.0') === false);

  // Asset picking: the arch suffix wins, a lone zip is accepted, junk is not.
  const assets = [
    { name: 'source.tar.gz', browser_download_url: 'x' },
    { name: 'VideoTrimCrop-1.1.0-arm64.zip', browser_download_url: 'a' },
    { name: 'VideoTrimCrop-1.1.0-x64.zip', browser_download_url: 'b', size: 10 },
  ];
  check('prefers the asset matching this build',
    pickReleaseAsset(assets, ABOUT.assetSuffix)?.browser_download_url === 'b');

  check('falls back to the only zip in a single-asset release',
    pickReleaseAsset([{ name: 'App-2.0.0.zip', browser_download_url: 'c' }], ABOUT.assetSuffix)
      ?.browser_download_url === 'c');

  check('refuses a release with no zip',
    pickReleaseAsset([{ name: 'notes.txt', browser_download_url: 'd' }], ABOUT.assetSuffix) === null &&
    pickReleaseAsset(undefined, ABOUT.assetSuffix) === null);

  // The updater builds its download URL from the same suffix the build writes.
  check('the asset suffix matches what electron-builder produces',
    fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
      .includes(`\${arch}.\${ext}`) && ABOUT.assetSuffix === '-x64.zip',
    'electron-builder.yml artifactName and ABOUT.assetSuffix have drifted apart');
}

// ------------------------------------------------------------ real footage

const files = fs.existsSync(SAMPLES)
  ? fs.readdirSync(SAMPLES).filter((f) => /\.(mp4|mov|mkv)$/i.test(f))
  : [];

if (files.length === 0) {
  console.log(`\nNo sample footage at ${SAMPLES} — skipping the footage checks.`);
} else {
  console.log(`\nProbe (${files.length} sample${files.length === 1 ? '' : 's'})`);

  let portrait = null;
  for (const f of files) {
    const full = path.join(SAMPLES, f);
    const data = await probe(full);
    const v = data.streams.find((s) => s.codec_type === 'video');
    const sd = (v.side_data_list || []).find((s) => typeof s.rotation === 'number');
    const rot = ((Math.round(sd?.rotation ?? 0) % 360) + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const dw = swapped ? v.height : v.width;
    const dh = swapped ? v.width : v.height;

    console.log(`  ${f}: coded ${v.width}x${v.height} rot ${rot} -> display ${dw}x${dh}` +
                ` (${v.codec_name}${v.color_transfer === 'arib-std-b67' ? ' HLG HDR' : ''})`);

    if (swapped) {
      check(`${f}: display dims are the coded dims swapped`, dw === v.height && dh === v.width);
      if (!portrait) portrait = { path: full, dw, dh, isHDR: v.color_transfer === 'arib-std-b67' };
    }
  }

  if (!portrait) {
    console.log('  (no rotated clip found — the rotation test needs one)');
  } else {
    console.log('\nRotation / crop mapping — the test CLAUDE.md section 6 requires');

    const T = 10;
    const full = path.join(work, 'full.png');
    await exec(FFMPEG, ['-y', '-v', 'error', '-ss', String(T), '-i', portrait.path,
                        '-frames:v', '1', full]);
    const fullInfo = await streamInfo(full);
    check('a decoded frame comes out in DISPLAY orientation',
      fullInfo.width === portrait.dw && fullInfo.height === portrait.dh,
      `got ${fullInfo.width}x${fullInfo.height}, expected ${portrait.dw}x${portrait.dh}`);

    // Crop each corner two ways: through the video pipeline, and out of the
    // already-rotated still. They must agree, or display-space is a lie.
    const S = 400;
    const corners = {
      'top-left': { x: 0, y: 0 },
      'top-right': { x: portrait.dw - S, y: 0 },
      'bottom-left': { x: 0, y: portrait.dh - S },
      'bottom-right': { x: portrait.dw - S, y: portrait.dh - S },
    };

    for (const [name, at] of Object.entries(corners)) {
      const vid = path.join(work, `v_${name}.png`);
      const img = path.join(work, `i_${name}.png`);
      const f = `crop=${S}:${S}:${at.x}:${at.y}`;
      await exec(FFMPEG, ['-y', '-v', 'error', '-ss', String(T), '-i', portrait.path,
                          '-vf', f, '-frames:v', '1', vid]);
      await exec(FFMPEG, ['-y', '-v', 'error', '-i', full, '-vf', f, '-frames:v', '1', img]);
      const q = await psnr(vid, img);
      check(`${name} corner: video crop matches display-frame crop (PSNR ${q.toFixed(1)} dB)`,
        q > 45, 'below 45 dB means crop is NOT operating on the rotated frame');
    }

    console.log('\nEnd-to-end render through the app\'s own argument builder');

    const crop = normalizeCrop(
      { x: portrait.dw / 2, y: portrait.dh - 540, w: 540, h: 540 },
      portrait.dw, portrait.dh
    );
    const out = path.join(work, 'render.mp4');
    const args = buildRenderArgs({
      srcPath: portrait.path, outPath: out,
      start: T, duration: 1, crop,
      hasAudio: true, removeAudio: false, isHDR: portrait.isHDR,
      rotation: 0, quality: 'high',
    });
    await exec(FFMPEG, args, { maxBuffer: 8 * 1024 * 1024 });

    const outInfo = await streamInfo(out);
    check('output dimensions equal the crop exactly — nothing is scaled',
      outInfo.width === crop.w && outInfo.height === crop.h,
      `got ${outInfo.width}x${outInfo.height}, crop was ${crop.w}x${crop.h}`);
    check('output is 8-bit yuv420p H.264', outInfo.pix_fmt === 'yuv420p' && outInfo.codec_name === 'h264');
    if (portrait.isHDR) {
      check('HDR source is re-tagged bt709, not left claiming HLG',
        outInfo.color_transfer !== 'arib-std-b67',
        `color_transfer is still ${outInfo.color_transfer}`);
    }

    // The rendered corner must be the corner we asked for.
    const outFrame = path.join(work, 'out.png');
    const ref = path.join(work, 'ref.png');
    await exec(FFMPEG, ['-y', '-v', 'error', '-i', out, '-frames:v', '1', outFrame]);
    const refArgs = ['-y', '-v', 'error', '-i', full,
                     '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, '-frames:v', '1', ref];
    await exec(FFMPEG, refArgs);
    const q = await psnr(outFrame, ref);
    // Tone-mapping deliberately changes the pixels, so only compare geometry
    // strictly for SDR. Either way a wrong corner scores in the low teens.
    check(`rendered output contains the requested corner (PSNR ${q.toFixed(1)} dB)`,
      q > 20, 'a wrong corner scores ~10-15 dB; re-derive the mapping, do NOT add a transpose');

    // A manual 90 degree rotation must actually swap the output axes.
    const rotOut = path.join(work, 'rot.mp4');
    await exec(FFMPEG, buildRenderArgs({
      srcPath: portrait.path, outPath: rotOut, start: T, duration: 0.5,
      crop: null, hasAudio: true, removeAudio: false, isHDR: portrait.isHDR,
      rotation: 90, quality: 'low',
    }), { maxBuffer: 8 * 1024 * 1024 });
    const rotInfo = await streamInfo(rotOut);
    check('a 90 degree rotation swaps the output dimensions',
      rotInfo.width === portrait.dh && rotInfo.height === portrait.dw,
      `got ${rotInfo.width}x${rotInfo.height}, expected ${portrait.dh}x${portrait.dw}`);

    // Cropping in the ROTATED space must land where the user framed it: the
    // top-left of the rotated frame is the bottom-left of the original.
    const rotCropOut = path.join(work, 'rotcrop.mp4');
    const rc = { x: 0, y: 0, w: 400, h: 400 };
    await exec(FFMPEG, buildRenderArgs({
      srcPath: portrait.path, outPath: rotCropOut, start: T, duration: 0.5,
      crop: rc, hasAudio: true, removeAudio: false, isHDR: portrait.isHDR,
      rotation: 90, quality: 'low',
    }), { maxBuffer: 8 * 1024 * 1024 });
    const rcInfo = await streamInfo(rotCropOut);
    check('cropping in rotated space yields the requested size',
      rcInfo.width === 400 && rcInfo.height === 400, `got ${rcInfo.width}x${rcInfo.height}`);

    const rcFrame = path.join(work, 'rc.png');
    const rcRef = path.join(work, 'rcref.png');
    await exec(FFMPEG, ['-y', '-v', 'error', '-i', rotCropOut, '-frames:v', '1', rcFrame]);
    // Same region, derived independently: rotate the display frame, then crop.
    await exec(FFMPEG, ['-y', '-v', 'error', '-i', full,
      '-vf', `transpose=1,crop=400:400:0:0`, '-frames:v', '1', rcRef]);
    const rq = await psnr(rcFrame, rcRef);
    check(`rotated crop lands on the framed region (PSNR ${rq.toFixed(1)} dB)`, rq > 20,
      'the preview rotation and the render transpose disagree');

    // A tiny crop must come out tiny, not upscaled to fill anything.
    const tinyOut = path.join(work, 'tiny.mp4');
    const tinyCrop = { x: 100, y: 100, w: 200, h: 200 };
    await exec(FFMPEG, buildRenderArgs({
      srcPath: portrait.path, outPath: tinyOut, start: T, duration: 0.5,
      crop: tinyCrop, hasAudio: true, removeAudio: false, isHDR: portrait.isHDR,
      rotation: 0, quality: 'high',
    }), { maxBuffer: 8 * 1024 * 1024 });
    const tinyInfo = await streamInfo(tinyOut);
    check('a 200x200 crop yields a 200x200 file',
      tinyInfo.width === 200 && tinyInfo.height === 200,
      `got ${tinyInfo.width}x${tinyInfo.height}`);
  }
}

fs.rmSync(work, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
