import { create } from 'zustand';
import { fullFrameCrop, normalizeCrop, fitRatio, ratioFor, viewSize } from './lib/crop.js';
import { decideTier, fileUrl, rememberVerdict, canDecode } from './lib/playback.js';
import { TIER, DEFAULT_QUALITY } from '@shared/ipc.js';
import { basename, duration as fmtDuration } from './lib/format.js';

const THUMB_HEIGHT = 64;
const LONG_IMPORT_WARN_SECONDS = 4 * 60;

/** Thumbnail count from the track's pixel width — see §9 of UI.md. */
export function thumbCountFor(trackWidth) {
  const perThumb = 108;
  return Math.max(12, Math.min(320, Math.round(trackWidth / perThumb) * 3));
}

const initial = {
  /** 'empty' | 'importing' | 'ready' */
  phase: 'empty',
  media: null,
  /** Playable URL: the original for tier 1, a proxy otherwise. */
  playbackUrl: null,
  /** Filesystem path behind playbackUrl. Preview only — never rendered from. */
  previewPath: null,
  tier: null,

  crop: null,
  aspect: 'free',
  /** Manual rotation in degrees clockwise, for a wrong display matrix. */
  rotation: 0,
  /** Display size after that rotation. Everything crop-related uses this. */
  view: { width: 0, height: 0 },

  trimStart: 0,
  trimEnd: 0,
  currentTime: 0,
  playing: false,
  loop: true,

  filmstrip: [],
  filmstripPending: false,
  /** Last measured track width, so a rebuild keeps the same thumbnail count. */
  trackWidth: 1000,

  outputPath: '',
  removeAudio: false,
  quality: DEFAULT_QUALITY,

  /** null | {stage, percent, etaSeconds, jobId, label} */
  job: null,
  /** null | {message, ffmpegTail} */
  error: null,
  /** null | {outputPath, size, width, height, duration} */
  success: null,
  /** null | {seconds, estimate, proceed} — the long tier 3 confirm strip */
  importConfirm: null,
  /** Transient note shown in the output bar, e.g. refusing a drop mid-render. */
  notice: null,
};

export const useStore = create((set, get) => ({
  ...initial,

  setNotice(notice) {
    set({ notice });
    if (notice) setTimeout(() => {
      if (get().notice === notice) set({ notice: null });
    }, 4000);
  },

  setError(message, ffmpegTail = '') {
    set({ error: { message, ffmpegTail }, job: null, success: null });
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ success: null }),

  /**
   * Load a file. Dropping a second video discards the current one — there is no
   * Replace button. A render in progress refuses the swap rather than silently
   * killing a job the user is waiting on.
   */
  async loadFile(filePath) {
    const state = get();
    if (state.job?.stage === 'render') {
      state.setNotice('Rendering — cancel first to load another file.');
      return;
    }
    if (!filePath) return;

    // Tear down whatever was loaded: kill jobs, wipe proxies and filmstrips.
    await window.api.release();

    set({
      ...initial,
      phase: 'importing',
      job: { stage: 'probe', percent: 0, label: 'Reading file' },
    });

    const probed = await window.api.probe(filePath);
    if (!probed.ok) {
      set({ ...initial, phase: 'empty' });
      get().setError(probed.message, probed.ffmpegTail);
      return;
    }
    const media = probed.value;
    if (!media.duration || !media.displayWidth || !media.displayHeight) {
      set({ ...initial, phase: 'empty' });
      get().setError('This file reports no usable video track.',
        `duration=${media.duration} ${media.displayWidth}x${media.displayHeight}`);
      return;
    }

    const originalUrl = fileUrl(media.path);
    const { tier, mode } = await decideTier(media, originalUrl);

    // Long tier 3 imports ask first rather than silently starting a long job.
    if (tier === TIER.TRANSCODE && media.duration > LONG_IMPORT_WARN_SECONDS) {
      set({
        importConfirm: {
          media,
          mode,
          seconds: media.duration,
          estimate: media.duration / 4.4,
        },
        job: null,
      });
      return;
    }

    await get().beginImport(media, tier, mode);
  },

  /** Second half of loadFile, split out so the confirm strip can resume it. */
  async beginImport(media, tier, mode) {
    set({ media, tier, importConfirm: null, phase: 'importing' });

    let playbackUrl = fileUrl(media.path);
    let previewPath = media.path;

    if (mode) {
      const label = mode === 'remux' ? 'Rewriting container' : 'Transcoding preview';
      set({ job: { stage: mode, percent: 0, label } });

      const res = await window.api.makeProxy({
        srcPath: media.path,
        duration: media.duration,
        mode,
      });
      if (!res.ok) {
        set({ ...initial, phase: 'empty' });
        if (!res.cancelled) get().setError(res.message, res.ffmpegTail);
        return;
      }
      previewPath = res.value.path;
      playbackUrl = fileUrl(previewPath);

      // A remux can still fail to play — verify before trusting it.
      if (mode === 'remux' && !(await canDecode(playbackUrl))) {
        rememberVerdict(media, false);
        set({ job: { stage: 'transcode', percent: 0, label: 'Transcoding preview' } });
        const t = await window.api.makeProxy({
          srcPath: media.path,
          duration: media.duration,
          mode: 'transcode',
        });
        if (!t.ok) {
          set({ ...initial, phase: 'empty' });
          if (!t.cancelled) get().setError(t.message, t.ffmpegTail);
          return;
        }
        previewPath = t.value.path;
        playbackUrl = fileUrl(previewPath);
        set({ tier: TIER.TRANSCODE });
      }
    }

    const suggested = await window.api.suggestOutput(media.path);

    const view = viewSize(media, 0);

    set({
      phase: 'ready',
      playbackUrl,
      previewPath,
      view,
      rotation: 0,
      crop: fullFrameCrop(view),
      aspect: 'free',
      trimStart: 0,
      trimEnd: media.duration,
      currentTime: 0,
      outputPath: suggested.ok ? suggested.value : '',
      job: null,
    });

    window.api.setTitle(
      `Video Trim & Crop — ${media.fileName} · ${media.displayWidth} × ${media.displayHeight}` +
        ` · ${media.fps ? `${Math.round(media.fps * 100) / 100} fps · ` : ''}` +
        `${fmtDuration(media.duration)} · ${media.codec}${media.isHDR ? ' HDR' : ''}`
    );

    get().rebuildFilmstrip();
  },

  /** Generate (or regenerate) the filmstrip. Failure is non-fatal. */
  async rebuildFilmstrip(width) {
    const { media, previewPath } = get();
    if (!media) return;
    const trackWidth = width || get().trackWidth;
    set({ filmstripPending: true, trackWidth });

    // Read from the proxy when there is one, otherwise the original. Preview
    // only either way — never an input to the render.
    const res = await window.api.makeFilmstrip({
      srcPath: previewPath || media.path,
      duration: media.duration,
      count: thumbCountFor(trackWidth),
      height: THUMB_HEIGHT,
      isHDR: media.isHDR,
      rotation: get().rotation,
    });

    if (!res.ok) {
      set({ filmstrip: [], filmstripPending: false });
      return;
    }
    set({ filmstrip: res.value.files.map(fileUrl), filmstripPending: false });
  },

  setCrop(crop) {
    const { view } = get();
    if (!view.width) return;
    set({ crop: normalizeCrop(crop, view.width, view.height) });
  },

  setAspect(aspectId) {
    const { view, crop } = get();
    if (!crop || !view.width) return;
    const ratio = ratioFor(aspectId, view);
    set({
      aspect: aspectId,
      crop: ratio ? fitRatio(crop, ratio, view.width, view.height) : crop,
    });
  },

  resetCrop() {
    const { view } = get();
    if (!view.width) return;
    set({ crop: fullFrameCrop(view), aspect: 'free' });
  },

  /**
   * Manual rotation. The axes swap on 90/270, so the crop is reset to the full
   * frame rather than being carried across into a differently shaped space —
   * that would be guesswork, and resetting is predictable. The filmstrip is
   * regenerated with the rotation baked in so it matches the player.
   */
  setRotation(rotation) {
    const { media, rotation: current } = get();
    if (!media || rotation === current) return;
    const view = viewSize(media, rotation);
    set({ rotation, view, crop: fullFrameCrop(view), aspect: 'free' });
    get().rebuildFilmstrip();
  },

  setQuality: (quality) => set({ quality }),

  setTrimStart(t) {
    const { trimEnd, media } = get();
    if (!media) return;
    set({ trimStart: Math.max(0, Math.min(t, trimEnd - 0.1)) });
  },

  setTrimEnd(t) {
    const { trimStart, media } = get();
    if (!media) return;
    set({ trimEnd: Math.min(media.duration, Math.max(t, trimStart + 0.1)) });
  },

  /**
   * Set both trim points at once, from a drag across the filmstrip.
   *
   * Doing this as two separate setTrimStart/setTrimEnd calls would clamp each
   * against the OTHER point's stale value, so dragging a new selection that
   * doesn't overlap the old one would collapse. The pair is resolved here in
   * one go instead.
   */
  setTrimRange(a, b) {
    const { media } = get();
    if (!media) return;
    const MIN = 0.1;
    let start = Math.max(0, Math.min(a, b));
    let end = Math.min(media.duration, Math.max(a, b));
    if (end - start < MIN) {
      // Too small to be useful; grow it, preferring to extend forwards.
      end = Math.min(media.duration, start + MIN);
      if (end - start < MIN) start = Math.max(0, end - MIN);
    }
    set({ trimStart: start, trimEnd: end });
  },

  resetTrim() {
    const { media } = get();
    if (!media) return;
    set({ trimStart: 0, trimEnd: media.duration });
  },

  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (playing) => set({ playing }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setRemoveAudio: (removeAudio) => set({ removeAudio }),
  setOutputPath: (outputPath) => set({ outputPath }),

  async chooseOutput() {
    const { outputPath } = get();
    const res = await window.api.chooseOutput(outputPath);
    if (res.ok && res.value) set({ outputPath: res.value });
  },

  /** Kick off the final render. Always reads the original, never the proxy. */
  async render() {
    const { media, crop, trimStart, trimEnd, outputPath, removeAudio, rotation, quality, view } = get();
    if (!media || !crop || !outputPath) return;

    const jobId = crypto.randomUUID();
    const isFull = crop.w === view.width && crop.h === view.height
      && crop.x === 0 && crop.y === 0;

    set({
      job: { stage: 'render', percent: 0, jobId, label: 'Encoding' },
      error: null,
      success: null,
    });

    const res = await window.api.process({
      jobId,
      srcPath: media.path,
      outPath: outputPath,
      start: trimStart,
      duration: trimEnd - trimStart,
      crop: isFull ? null : crop,
      hasAudio: media.hasAudio,
      removeAudio,
      isHDR: media.isHDR,
      rotation,
      quality,
    });

    if (!res.ok) {
      if (res.cancelled) {
        set({ job: null });
      } else {
        get().setError(res.message, res.ffmpegTail);
      }
      return;
    }

    const next = await window.api.suggestOutput(media.path);
    set({
      job: null,
      success: {
        outputPath: res.value.outputPath,
        size: res.value.size,
        width: crop.w,
        height: crop.h,
        duration: trimEnd - trimStart,
      },
      outputPath: next.ok ? next.value : outputPath,
    });
  },

  async cancelJob() {
    const { job } = get();
    if (!job?.jobId) {
      set({ job: null });
      return;
    }
    await window.api.cancel(job.jobId);
    set({ job: null });
  },

  applyProgress({ jobId, stage, percent, etaSeconds }) {
    const { job } = get();
    if (!job) return;
    if (stage === 'filmstrip') return; // strip progress is not shown in the bar
    if (job.jobId && jobId && job.jobId !== jobId) return;
    set({ job: { ...job, stage, percent, etaSeconds } });
  },
}));

export { basename };
