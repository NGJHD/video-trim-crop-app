import { execFile } from 'child_process';
import path from 'path';
import { FFPROBE } from './binaries.js';
import { HDR_TRANSFERS } from '../shared/ipc.js';

/** Run ffprobe and return parsed JSON, or throw with the stderr tail attached. */
function ffprobeJson(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '').split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
          reject(
            Object.assign(new Error('Could not read this file'), {
              ffmpegTail: tail || String(err.message),
            })
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(Object.assign(new Error('ffprobe returned malformed JSON'), { ffmpegTail: stdout.slice(0, 2000) }));
        }
      }
    );
  });
}

/** Parse "30000/1001" into 29.97. */
function parseRate(rate) {
  if (!rate || typeof rate !== 'string') return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!den) return num || 0;
  return num / den;
}

/** Rotation in degrees from the display matrix side data, normalised to 0/90/180/270. */
function readRotation(stream) {
  let deg = 0;
  const sd = (stream.side_data_list || []).find((s) => typeof s.rotation === 'number');
  if (sd) deg = sd.rotation;
  else if (stream.tags && stream.tags.rotate) deg = Number(stream.tags.rotate) || 0;
  deg = ((Math.round(deg) % 360) + 360) % 360;
  return deg;
}

/**
 * Probe a file into MediaInfo.
 *
 * This is the ONLY place raw ffprobe width/height are read. Display dimensions
 * are computed once, here, and everything downstream uses those — a portrait
 * phone clip reports 1920x1080 coded with a 90 degree rotation and must be
 * treated as 1080x1920. See CLAUDE.md section 6.
 *
 * @param {string} filePath
 * @returns {Promise<import('../shared/ipc.js').MediaInfo>}
 */
export async function probeMedia(filePath) {
  const data = await ffprobeJson(filePath);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  if (!video) {
    throw Object.assign(new Error('This file has no video stream'), {
      ffmpegTail: `Streams found: ${(data.streams || []).map((s) => s.codec_type).join(', ') || 'none'}`,
    });
  }

  const rotation = readRotation(video);
  const swapped = rotation === 90 || rotation === 270;
  const codedWidth = Number(video.width) || 0;
  const codedHeight = Number(video.height) || 0;

  const duration =
    Number(data.format?.duration) || Number(video.duration) || 0;
  const fps = parseRate(video.r_frame_rate) || parseRate(video.avg_frame_rate);
  const colorTransfer = video.color_transfer || '';

  return {
    path: filePath,
    fileName: path.basename(filePath),
    container: data.format?.format_name || '',
    codec: video.codec_name || '',
    profile: video.profile || '',
    pixFmt: video.pix_fmt || '',
    codedWidth,
    codedHeight,
    rotation,
    displayWidth: swapped ? codedHeight : codedWidth,
    displayHeight: swapped ? codedWidth : codedHeight,
    duration,
    fps,
    nbFrames: Number(video.nb_frames) || Math.round(duration * fps) || 0,
    hasAudio: (data.streams || []).some((s) => s.codec_type === 'audio'),
    isHDR: HDR_TRANSFERS.includes(colorTransfer),
    colorTransfer,
  };
}
