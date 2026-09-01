import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { timecode } from '../lib/format.js';

/** How far the pointer must travel before a press counts as a drag, in px. */
const DRAG_THRESHOLD = 8;

/**
 * Play, stop and the loop checkbox sit in a control column to the LEFT of the
 * track, so the filmstrip runs unbroken to the right edge. No skip or step
 * buttons — those are keyboard only.
 *
 * The track itself answers three gestures: click to seek, drag to define a trim
 * selection, right-click for the trim menu.
 */
export default function TimelineBar({ videoRef }) {
  const trackRef = useRef(null);
  const media = useStore((s) => s.media);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const currentTime = useStore((s) => s.currentTime);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const trimStart = useStore((s) => s.trimStart);
  const trimEnd = useStore((s) => s.trimEnd);
  const setTrimStart = useStore((s) => s.setTrimStart);
  const setTrimEnd = useStore((s) => s.setTrimEnd);
  const setTrimRange = useStore((s) => s.setTrimRange);
  const filmstrip = useStore((s) => s.filmstrip);
  const filmstripPending = useStore((s) => s.filmstripPending);
  const rebuildFilmstrip = useStore((s) => s.rebuildFilmstrip);
  const ready = useStore((s) => s.phase === 'ready');

  const [drag, setDrag] = useState(null); // 'in' | 'out' | 'select' | 'playhead'
  /**
   * A press on the track is ambiguous until the pointer moves: a click seeks,
   * a drag defines a new trim selection. This holds the press until one of the
   * two is decided by DRAG_THRESHOLD.
   */
  const press = useRef(null);
  /** null | { x, y, time } — right-click menu on the filmstrip. */
  const [menu, setMenu] = useState(null);

  const duration = media?.duration || 0;
  const pct = (t) => (duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);

  const timeAt = useCallback(
    (clientX) => {
      const el = trackRef.current;
      if (!el || !duration) return 0;
      const box = el.getBoundingClientRect();
      return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration));
    },
    [duration]
  );

  const seek = useCallback(
    (t) => {
      const el = videoRef.current;
      if (el) el.currentTime = t;
    },
    [videoRef]
  );

  // Regenerate the strip when the track width changes materially. Below the
  // threshold the existing tiles just stretch, which is cheaper and invisible.
  const lastWidth = useRef(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !ready) return;
    let timer;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (!lastWidth.current) { lastWidth.current = w; rebuildFilmstrip(w); return; }
      if (Math.abs(w - lastWidth.current) / lastWidth.current < 0.15) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        lastWidth.current = w;
        rebuildFilmstrip(w);
      }, 300);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [ready, rebuildFilmstrip]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (e) => {
      const t = timeAt(e.clientX);
      if (drag === 'in') { setTrimStart(t); seek(t); return; }
      if (drag === 'out') { setTrimEnd(t); seek(t); return; }
      // The playhead handle scrubs and nothing else — it never edits the trim.
      if (drag === 'playhead') { seek(t); setCurrentTime(t); return; }

      // 'select': only becomes a selection once the pointer has actually
      // travelled, so a click that wobbles by a pixel still just seeks.
      const p = press.current;
      if (!p) return;
      if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_THRESHOLD) return;
      p.moved = true;
      setTrimRange(p.time, t);
      seek(t);
    };

    const onUp = () => {
      const p = press.current;
      // A real drag leaves the playhead at the start of what was selected;
      // a plain click already seeked on pointerdown and needs nothing.
      if (p && p.moved) seek(useStore.getState().trimStart);
      press.current = null;
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, timeAt, setTrimStart, setTrimEnd, setTrimRange, setCurrentTime, seek]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      // Starting from outside the selection would play footage that isn't in
      // the output, so snap to the start first. Independent of the loop
      // setting — the selection bounds playback either way.
      if (el.currentTime < trimStart || el.currentTime >= trimEnd - 0.02) {
        el.currentTime = trimStart;
      }
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  /** Stop: pause and rewind to the start of the selection. */
  const stop = () => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = trimStart;
    setCurrentTime(trimStart);
  };

  return (
    <div className="flex shrink-0 items-stretch gap-3 border-t border-neutral-800 bg-neutral-900 px-4 py-3">
      {/* Control column: play and stop side by side, loop stacked underneath */}
      <div className="flex w-[104px] shrink-0 flex-col gap-1.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={!ready}
            onClick={togglePlay}
            className="flex h-9 flex-1 items-center justify-center rounded border border-neutral-700
                       bg-neutral-800 text-neutral-100 transition-colors hover:border-neutral-600
                       hover:bg-neutral-700 disabled:cursor-default disabled:opacity-40"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? (
              <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor" aria-hidden>
                <rect x="1" y="1" width="4" height="12" rx="1" />
                <rect x="8" y="1" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor" aria-hidden>
                <path d="M2 1.5v11l10-5.5z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            disabled={!ready}
            onClick={stop}
            className="flex h-9 flex-1 items-center justify-center rounded border border-neutral-700
                       bg-neutral-800 text-neutral-100 transition-colors hover:border-neutral-600
                       hover:bg-neutral-700 disabled:cursor-default disabled:opacity-40"
            title="Stop — back to the start of the selection"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="1" y="1" width="10" height="10" rx="1" />
            </svg>
          </button>
        </div>

        <label
          className={
            'flex h-7 items-center gap-2 text-[12px] ' +
            (ready ? 'cursor-pointer text-neutral-400' : 'text-neutral-600')
          }
          title="Loop the trim selection (L)"
        >
          <input
            type="checkbox"
            checked={loop}
            disabled={!ready}
            onChange={toggleLoop}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          loop
        </label>
      </div>

      {/* Filmstrip track, with the playhead handle riding above it */}
      <div className="min-w-0 flex-1">
        {/* A grab handle for the playhead. The track is busy with three other
            gestures, so scrubbing gets its own target rather than competing
            with drag-to-select. The gap keeps it from looking welded to the
            filmstrip. */}
        <div className="relative h-3.5">
          {ready && (
            <div
              className="absolute bottom-[3px] h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize
                         rounded-[2px] border border-neutral-900 bg-white shadow-sm"
              style={{ left: `${pct(currentTime)}%` }}
              title="Drag to scrub · right-click to set a trim point here"
              onPointerDown={(e) => {
                if (!ready || e.button !== 0) return;
                // Stops the press reaching the window listener that dismisses
                // the menu, so close it here instead.
                e.stopPropagation();
                setMenu(null);
                setDrag('playhead');
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Acts on the playhead position, not on where the cursor is.
                setMenu({ x: e.clientX, y: e.clientY, time: currentTime });
              }}
            >
              {/* Stem bridging the gap down to the track, so the box reads as
                  the head of the playhead line rather than a floating chip.
                  The gap stays between the BOX and the filmstrip; the line
                  crosses it. */}
              <span className="pointer-events-none absolute left-1/2 top-full h-[3px] w-px
                               -translate-x-1/2 bg-white" />
            </div>
          )}
        </div>

        <div
          ref={trackRef}
          className="relative h-16 w-full overflow-hidden rounded border border-neutral-800 bg-neutral-950"
          onPointerDown={(e) => {
            if (!ready || e.button !== 0) return;
            // Seek straight away so a click feels immediate. If this turns out
            // to be a drag, the move handler takes over and builds a selection.
            const t = timeAt(e.clientX);
            seek(t);
            press.current = { x: e.clientX, time: t, moved: false };
            setDrag('select');
          }}
          onContextMenu={(e) => {
            if (!ready) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, time: timeAt(e.clientX) });
          }}
        >
          {/* Thumbnails, edge to edge */}
          <div className="pointer-events-none absolute inset-0 flex">
            {filmstrip.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                draggable={false}
                className="h-full min-w-0 flex-1 object-cover"
              />
            ))}
          </div>

          {filmstrip.length === 0 && (
            <div className="pointer-events-none absolute inset-0 bg-neutral-800/40" />
          )}

          {/* Shown for every rebuild, not just the first — rotating the video
              regenerates the strip, and without this there is no sign anything
              is happening. Translucent so the old strip stays readable
              underneath and the timeline remains usable while it works. */}
          {filmstripPending && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center
                            bg-neutral-950/55 backdrop-blur-[1px]">
              <span className="animate-pulse rounded bg-neutral-900/80 px-2.5 py-1 text-[11px]
                               text-neutral-300 shadow-sm">
                building filmstrip…
              </span>
            </div>
          )}

          {/* Dim what falls outside the selection */}
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-neutral-950/70
                          backdrop-grayscale" style={{ width: `${pct(trimStart)}%` }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 bg-neutral-950/70
                          backdrop-grayscale" style={{ width: `${100 - pct(trimEnd)}%` }} />

          {ready && (
            <>
              {/* Trim handles */}
              <div
                className="absolute inset-y-0 z-20 w-[9px] -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${pct(trimStart)}%` }}
                onPointerDown={(e) => { e.stopPropagation(); setDrag('in'); }}
              >
                <div className="mx-auto h-full w-[3px] bg-amber-400" />
              </div>
              <div
                className="absolute inset-y-0 z-20 w-[9px] -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${pct(trimEnd)}%` }}
                onPointerDown={(e) => { e.stopPropagation(); setDrag('out'); }}
              >
                <div className="mx-auto h-full w-[3px] bg-amber-400" />
              </div>

              {/* Playhead */}
              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white
                           shadow-[0_0_4px_rgba(0,0,0,0.9)]"
                style={{ left: `${pct(currentTime)}%` }}
              />
            </>
          )}
        </div>

        {/* Right-click menu: set either trim point at the clicked frame, which
            is quicker than dragging a handle across a long clip. */}
        {menu && (
          <div
            className="fixed z-50 min-w-[190px] overflow-hidden rounded border border-neutral-700
                       bg-neutral-900 py-1 shadow-lg shadow-black/50"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-[11px] tabular-nums text-neutral-500">
              at {timecode(menu.time)}
            </div>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[13px] text-neutral-200
                         hover:bg-neutral-800 disabled:text-neutral-600 disabled:hover:bg-transparent"
              disabled={menu.time >= trimEnd - 0.1}
              onClick={() => { setTrimStart(menu.time); seek(menu.time); setMenu(null); }}
            >
              Set trim start here
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[13px] text-neutral-200
                         hover:bg-neutral-800 disabled:text-neutral-600 disabled:hover:bg-transparent"
              disabled={menu.time <= trimStart + 0.1}
              onClick={() => { setTrimEnd(menu.time); seek(menu.time); setMenu(null); }}
            >
              Set trim end here
            </button>
          </div>
        )}

        {/* Trim timecodes, under their handles. No running current/total readout. */}
        <div className="relative mt-1 h-4 text-[11px] tabular-nums text-neutral-400">
          {ready && (
            <>
              <span className="absolute -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${pct(trimStart)}%` }}>
                {timecode(trimStart)}
              </span>
              <span className="absolute -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${pct(trimEnd)}%` }}>
                {timecode(trimEnd)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
