/**
 * Runtime tier detection.
 *
 * Never hardcode which codecs Chromium can play. HEVC in particular decodes
 * only where the machine has a hardware decoder, and standard Chromium and
 * Electron builds ship no software fallback — so the same binary gives
 * different answers on different machines, and any static table is wrong
 * somewhere. See CLAUDE.md section 5.1.1.
 *
 * We decide by TRYING, not by asking canPlayType() / isTypeSupported(). Those
 * answer "probably"/"maybe", are wrong in both directions often enough to
 * matter, and using them would mean building RFC 6381 codec strings out of
 * ffprobe fields. Loading the file is ground truth.
 */

import { REMUXABLE_CODECS, NATIVE_CONTAINERS, TIER } from '@shared/ipc.js';

/** Session cache, keyed on the properties that actually determine decodability. */
const verdicts = new Map();

const keyFor = (media) => `${media.codec}/${media.profile}/${media.pixFmt}`;

/**
 * Load a URL into a detached <video> and wait for one decoded frame.
 * @returns {Promise<boolean>}
 */
export function canDecode(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(el);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        /* teardown is best effort */
      }
      el.remove();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    el.addEventListener('error', () => finish(false));

    // A decoded frame is the real signal. loadeddata alone can fire for a file
    // whose container parses but whose video track never produces a picture.
    if (typeof el.requestVideoFrameCallback === 'function') {
      el.requestVideoFrameCallback(() => finish(true));
      el.addEventListener('loadeddata', () => {
        el.play().catch(() => {
          // Autoplay blocked: fall back to dimensions, which are only non-zero
          // once a track has been successfully configured.
          if (el.videoWidth > 0) finish(true);
        });
      });
    } else {
      el.addEventListener('loadeddata', () => finish(el.videoWidth > 0));
    }

    el.src = url;
  });
}

/**
 * Decide the import tier for a probed file.
 *
 * @param {import('@shared/ipc.js').MediaInfo} media
 * @param {string} url  file:// URL for the original
 * @returns {Promise<{tier:number, mode:'remux'|'transcode'|null}>}
 */
export async function decideTier(media, url) {
  const key = keyFor(media);

  if (verdicts.has(key)) {
    if (verdicts.get(key)) return { tier: TIER.DIRECT, mode: null };
  } else {
    const playable = await canDecode(url);
    verdicts.set(key, playable);
    if (playable) return { tier: TIER.DIRECT, mode: null };
  }

  // Playback failed. The ffprobe codec is only a hint for what to do next:
  // a remux can only help when the codec itself is fine and the container is
  // the problem. Being wrong here costs time, not correctness.
  const codecOk = REMUXABLE_CODECS.includes(media.codec);
  const containerNative = NATIVE_CONTAINERS.includes(media.container);
  if (codecOk && !containerNative) return { tier: TIER.REMUX, mode: 'remux' };
  return { tier: TIER.TRANSCODE, mode: 'transcode' };
}

/** Record a verdict learned elsewhere, e.g. after a remux that still won't play. */
export function rememberVerdict(media, playable) {
  verdicts.set(keyFor(media), playable);
}

/** Windows paths need encoding, and backslashes have to become slashes. */
export function fileUrl(p) {
  if (!p) return '';
  const normalized = p.replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${withSlash.split('/').map(encodeURIComponent).join('/')}`;
}
