import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { renderedVideoRect } from '../lib/crop.js';
import CropOverlay from './CropOverlay.jsx';

/**
 * The preview stage: the <video> element letterboxed inside the available
 * space, with the crop overlay on top. Absorbs all slack when the window grows.
 *
 * The padding is not decoration — the crop handles sit ON the frame edge and
 * extend half their width outside it, so without breathing room the edge
 * handles are unreachable at the window border.
 */
export default function Stage({ videoRef }) {
  const containerRef = useRef(null);
  const playbackUrl = useStore((s) => s.playbackUrl);
  const view = useStore((s) => s.view);
  const rotation = useStore((s) => s.rotation);
  const loop = useStore((s) => s.loop);
  const trimStart = useStore((s) => s.trimStart);
  const trimEnd = useStore((s) => s.trimEnd);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setPlaying = useStore((s) => s.setPlaying);

  const [box, setBox] = useState({ width: 0, height: 0 });

  // Measure the content box (inside the padding) and derive the letterboxed
  // video rect from it. The crop lives in source space, so it re-projects onto
  // a new rect exactly — resizing never moves the crop by a pixel.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rect = useMemo(
    () => renderedVideoRect(box, view.width, view.height),
    [box, view.width, view.height]
  );

  /**
   * Rotating with CSS keeps the preview instant — no re-encode. The element is
   * laid out at its PRE-rotation size, centred on the target rect, so that after
   * the transform it lands exactly on `rect`. The render applies the matching
   * transpose filter, so what is framed here is what comes out.
   */
  const videoStyle = useMemo(() => {
    const swap = rotation === 90 || rotation === 270;
    const w = swap ? rect.height : rect.width;
    const h = swap ? rect.width : rect.height;
    return {
      position: 'absolute',
      left: rect.left + (rect.width - w) / 2,
      top: rect.top + (rect.height - h) / 2,
      width: w,
      height: h,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    };
  }, [rect, rotation]);

  /**
   * Playback is always confined to the trim range — the trimmed selection IS
   * the clip you are working on, so playing past it shows you footage that
   * won't be in the output.
   *
   * The loop toggle only decides what happens when the end is reached: wrap
   * back to the start, or stop there. It is NOT what makes the boundary
   * apply. (Getting that wrong meant unchecking loop played the whole file.)
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onTime = () => {
      setCurrentTime(el.currentTime);
      if (el.paused || el.seeking) return;

      if (el.currentTime >= trimEnd - 0.02) {
        if (loop) {
          el.currentTime = trimStart;
        } else {
          el.pause();
          el.currentTime = trimEnd;
        }
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      if (loop) {
        el.currentTime = trimStart;
        el.play().catch(() => {});
      } else {
        el.currentTime = trimEnd;
      }
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [videoRef, loop, trimStart, trimEnd, setCurrentTime, setPlaying]);

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-neutral-950 p-8">
      <div ref={containerRef} className="relative h-full w-full select-none">
        {playbackUrl && (
          <video
            ref={videoRef}
            src={playbackUrl}
            className="pointer-events-none object-contain"
            style={videoStyle}
            preload="auto"
          />
        )}
        <CropOverlay containerRef={containerRef} rect={rect} />
      </div>
    </div>
  );
}
