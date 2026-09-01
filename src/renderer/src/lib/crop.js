/**
 * Crop geometry.
 *
 * ALL crop coordinates are in DISPLAY SPACE — the frame as the user sees it,
 * rotation already applied. There is no source-space conversion and no inverse
 * rotation math anywhere in this file, because both ends of the pipeline agree
 * on display space: Chromium applies the display matrix when rendering <video>,
 * and FFmpeg auto-rotates ahead of user filters so `crop` sees the same frame.
 * Verified end-to-end against a real portrait clip. See CLAUDE.md section 6.
 *
 * A manual rotation (CLAUDE.md 6.1) does not break that. It is applied to BOTH
 * ends — as a CSS transform on the preview and as a transpose filter placed
 * BEFORE crop in the render chain — so display space simply becomes the rotated
 * frame and every function here keeps working on it unchanged. `viewSize()`
 * below is the one place that knows the axes can swap.
 */

export const MIN_CROP = 32;

export const ASPECTS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: 'original', label: 'Original', ratio: 'original' },
];

/**
 * Resolve an aspect id to a numeric ratio, or null for free-form.
 * `view` is the display size AFTER any manual rotation, so "Original" follows
 * the frame the user is actually looking at.
 */
export function ratioFor(aspectId, view) {
  const entry = ASPECTS.find((a) => a.id === aspectId);
  if (!entry || entry.ratio === null) return null;
  if (entry.ratio === 'original') {
    if (!view?.width || !view?.height) return null;
    return view.width / view.height;
  }
  return entry.ratio;
}

/**
 * Display size after the user's manual rotation. A 90 or 270 degree correction
 * swaps the axes, and every crop calculation works in THIS space — which is
 * also the space the render's filter chain produces, because rotate runs before
 * crop there too.
 */
export function viewSize(media, rotation = 0) {
  if (!media) return { width: 0, height: 0 };
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? media.displayHeight : media.displayWidth,
    height: swap ? media.displayWidth : media.displayHeight,
  };
}

/**
 * The rectangle the video actually occupies inside its container. The <video>
 * element is letterboxed, so this is never just the container box — a landscape
 * clip in a maximised window has a lot of letterbox to accidentally grab.
 *
 * @param {DOMRect} containerRect
 * @param {number} displayWidth
 * @param {number} displayHeight
 */
export function renderedVideoRect(containerRect, displayWidth, displayHeight) {
  const cw = containerRect.width;
  const ch = containerRect.height;
  if (!cw || !ch || !displayWidth || !displayHeight) {
    return { left: 0, top: 0, width: 0, height: 0, scale: 1 };
  }
  const srcAspect = displayWidth / displayHeight;
  const boxAspect = cw / ch;

  let width;
  let height;
  if (srcAspect > boxAspect) {
    width = cw;
    height = cw / srcAspect;
  } else {
    height = ch;
    width = ch * srcAspect;
  }
  return {
    left: (cw - width) / 2,
    top: (ch - height) / 2,
    width,
    height,
    // Source display px per CSS px. When a tier 3 proxy is in use this still
    // holds, because the proxy is a scaled version of the display-oriented frame.
    scale: displayWidth / width,
  };
}

/** Screen point (relative to the container) to display-space source coords. */
export function toSource(px, py, rect) {
  return {
    x: (px - rect.left) * rect.scale,
    y: (py - rect.top) * rect.scale,
  };
}

/** Display-space crop to a CSS box relative to the container. */
export function toScreen(crop, rect) {
  return {
    left: rect.left + crop.x / rect.scale,
    top: rect.top + crop.y / rect.scale,
    width: crop.w / rect.scale,
    height: crop.h / rect.scale,
  };
}

const evenDown = (n) => Math.max(0, Math.floor(n / 2) * 2);

/**
 * Clamp to the frame, enforce the minimum, and round to even integers.
 * Odd dimensions fail outright under yuv420p chroma subsampling.
 */
export function normalizeCrop(crop, displayWidth, displayHeight) {
  let w = Math.min(crop.w, displayWidth);
  let h = Math.min(crop.h, displayHeight);
  w = Math.max(MIN_CROP, w);
  h = Math.max(MIN_CROP, h);

  let x = Math.min(Math.max(0, crop.x), displayWidth - w);
  let y = Math.min(Math.max(0, crop.y), displayHeight - h);

  x = evenDown(x);
  y = evenDown(y);
  w = evenDown(w);
  h = evenDown(h);

  // Even-rounding can push the box past the edge by a pixel; pull it back.
  if (x + w > displayWidth) x = evenDown(displayWidth - w);
  if (y + h > displayHeight) y = evenDown(displayHeight - h);

  return { x, y, w, h };
}

export function fullFrameCrop(view) {
  return normalizeCrop({ x: 0, y: 0, w: view.width, h: view.height }, view.width, view.height);
}

export function isFullFrame(crop, view) {
  const full = fullFrameCrop(view);
  return crop.x === full.x && crop.y === full.y && crop.w === full.w && crop.h === full.h;
}

/**
 * Fit the largest rectangle of `ratio` inside the frame, keeping the current
 * rectangle's centre. Used when the aspect mode changes.
 */
export function fitRatio(crop, ratio, displayWidth, displayHeight) {
  if (!ratio) return normalizeCrop(crop, displayWidth, displayHeight);

  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;

  let w = crop.w;
  let h = w / ratio;
  if (h > displayHeight) {
    h = displayHeight;
    w = h * ratio;
  }
  if (w > displayWidth) {
    w = displayWidth;
    h = w / ratio;
  }
  return normalizeCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, displayWidth, displayHeight);
}

/**
 * Resize during a drag, in SCREEN space, with the aspect lock applied here and
 * not afterwards — rounding to even numbers drifts the ratio slightly and that
 * is accepted rather than corrected.
 *
 * @param {string} handle  one of nw n ne e se s sw w
 * @param {{x:number,y:number,w:number,h:number}} start  crop at drag start, source space
 * @param {{x:number,y:number}} delta  pointer movement in source space
 * @param {number|null} ratio
 * @param {boolean} fromCenter
 */
export function resizeCrop(handle, start, delta, ratio, fromCenter, displayWidth, displayHeight) {
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  if (east) w = start.w + delta.x;
  if (west) {
    w = start.w - delta.x;
    x = right - w;
  }
  if (south) h = start.h + delta.y;
  if (north) {
    h = start.h - delta.y;
    y = bottom - h;
  }

  if (fromCenter) {
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    if (east || west) {
      w = Math.abs(east ? (start.w / 2 + delta.x) * 2 : (start.w / 2 - delta.x) * 2);
      x = cx - w / 2;
    }
    if (north || south) {
      h = Math.abs(south ? (start.h / 2 + delta.y) * 2 : (start.h / 2 - delta.y) * 2);
      y = cy - h / 2;
    }
  }

  w = Math.max(MIN_CROP, w);
  h = Math.max(MIN_CROP, h);

  if (ratio) {
    // Edge handles drive the one dimension they own; corners follow width.
    if (!east && !west) {
      w = h * ratio;
    } else if (!north && !south) {
      h = w / ratio;
    } else {
      h = w / ratio;
    }

    if (fromCenter) {
      const cx = start.x + start.w / 2;
      const cy = start.y + start.h / 2;
      x = cx - w / 2;
      y = cy - h / 2;
    } else {
      if (west) x = right - w;
      if (north) y = bottom - h;
      if (!north && !south) y = start.y + (start.h - h) / 2;
      if (!east && !west) x = start.x + (start.w - w) / 2;
    }
  }

  return normalizeCrop({ x, y, w, h }, displayWidth, displayHeight);
}
