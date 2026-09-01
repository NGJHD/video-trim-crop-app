/**
 * The IPC contract. Imported by main, preload and renderer.
 * Never write a channel name as a string literal at a call site.
 */

export const CH = {
  // renderer -> main (invoke)
  MEDIA_PROBE: 'media:probe',
  MEDIA_PROXY: 'media:proxy',
  MEDIA_FILMSTRIP: 'media:filmstrip',
  MEDIA_PROCESS: 'media:process',
  MEDIA_CANCEL: 'media:cancel',
  MEDIA_RELEASE: 'media:release',
  OUTPUT_SUGGEST: 'output:suggest',
  OUTPUT_CHOOSE: 'output:choose',
  FILE_CHOOSE: 'file:choose',
  FILE_INITIAL: 'file:initial',
  FILE_REVEAL: 'file:reveal',
  WINDOW_TITLE: 'window:title',

  // main -> renderer (send)
  JOB_PROGRESS: 'job:progress',
  JOB_DONE: 'job:done',
  JOB_ERROR: 'job:error',
};

/** Stages a job can report, used for progress copy. */
export const STAGE = {
  REMUX: 'remux',
  TRANSCODE: 'transcode',
  FILMSTRIP: 'filmstrip',
  RENDER: 'render',
};

/** Import tiers. Decided at runtime by trying to play the file — see CLAUDE.md 5.1.1. */
export const TIER = {
  DIRECT: 1,
  REMUX: 2,
  TRANSCODE: 3,
};

/**
 * Codecs worth attempting a `-c copy` remux for when native playback fails.
 * This is only a HINT for choosing tier 2 vs tier 3 after the playback probe
 * has already failed. It is never used to decide tier 1 — being wrong here
 * costs time, not correctness.
 */
export const REMUXABLE_CODECS = ['h264', 'vp8', 'vp9', 'av1'];

/** Containers the `<video>` element can open, so a remux would be pointless. */
export const NATIVE_CONTAINERS = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'];

/**
 * Manual rotation, for footage whose phone wrote the wrong display matrix.
 * Degrees are CLOCKWISE, matching both CSS `rotate()` and FFmpeg's transpose
 * filters, so the preview and the render always agree.
 */
export const ROTATIONS = [
  { id: 0, label: 'None' },
  { id: 90, label: '90°' },
  { id: 180, label: '180°' },
  { id: 270, label: '270°' },
];

/**
 * Output quality. The default stays High, which is the setting the render spec
 * was designed and verified around; the other two exist for when a smaller file
 * matters more than transparency.
 */
export const QUALITY = {
  high: { id: 'high', label: 'High', crf: '17', preset: 'slow', audioBitrate: '256k' },
  medium: { id: 'medium', label: 'Medium', crf: '20', preset: 'medium', audioBitrate: '192k' },
  low: { id: 'low', label: 'Low', crf: '23', preset: 'fast', audioBitrate: '128k' },
};

export const DEFAULT_QUALITY = 'high';

/** ffprobe color_transfer values that mean the source is HDR. */
export const HDR_TRANSFERS = ['arib-std-b67', 'smpte2084'];

/**
 * @typedef {object} MediaInfo
 * @property {string}  path          Absolute path to the original file.
 * @property {string}  fileName
 * @property {string}  container     ffprobe format_name.
 * @property {string}  codec         ffprobe codec_name.
 * @property {string}  profile
 * @property {string}  pixFmt
 * @property {number}  codedWidth    Raw ffprobe width. Do not use for layout.
 * @property {number}  codedHeight   Raw ffprobe height. Do not use for layout.
 * @property {number}  rotation      Degrees from the display matrix, or 0.
 * @property {number}  displayWidth  Coded dims with rotation applied. Use this.
 * @property {number}  displayHeight
 * @property {number}  duration      Seconds.
 * @property {number}  fps
 * @property {number}  nbFrames
 * @property {boolean} hasAudio
 * @property {boolean} isHDR         Needs the tone-map chain on render.
 * @property {string}  colorTransfer
 */

/**
 * @typedef {object} Crop
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {object} ProcessRequest
 * @property {string}  srcPath      ALWAYS the original file, never a proxy.
 * @property {string}  outPath
 * @property {number}  start        Seconds.
 * @property {number}  duration     Seconds.
 * @property {Crop|null} crop       null means full frame, no -vf crop.
 * @property {boolean} hasAudio
 * @property {boolean} removeAudio
 * @property {boolean} isHDR
 * @property {number}  rotation     Manual correction in degrees clockwise.
 * @property {string}  quality      Key into QUALITY.
 */

/**
 * @typedef {object} JobProgress
 * @property {string} jobId
 * @property {string} stage
 * @property {number} percent   0-100.
 * @property {number} [etaSeconds]
 */
