import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { ratioFor, toScreen, toSource, resizeCrop, normalizeCrop, MIN_CROP } from '../lib/crop.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

/**
 * The crop rectangle drawn over the video.
 *
 * Pointer coordinates and getBoundingClientRect are both in CSS pixels, so they
 * share one coordinate system regardless of the Windows display scaling factor
 * — no devicePixelRatio correction is needed or wanted here.
 */
export default function CropOverlay({ containerRef, rect }) {
  const view = useStore((s) => s.view);
  const crop = useStore((s) => s.crop);
  const aspect = useStore((s) => s.aspect);
  const setCrop = useStore((s) => s.setCrop);
  const resetCrop = useStore((s) => s.resetCrop);

  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  const pointerToSource = useCallback(
    (e) => {
      const box = containerRef.current.getBoundingClientRect();
      return toSource(e.clientX - box.left, e.clientY - box.top, rect);
    },
    [containerRef, rect]
  );

  const onPointerDown = useCallback(
    (e, mode, handle) => {
      if (e.button !== 0 || !crop || !rect.width) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);

      const origin = pointerToSource(e);
      drag.current = {
        mode,
        handle,
        origin,
        startCrop: { ...crop },
        alt: e.altKey,
      };
      setDragging(true);
    },
    [crop, rect.width, pointerToSource]
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e) => {
      const d = drag.current;
      if (!d || !view.width) return;
      const box = containerRef.current.getBoundingClientRect();
      const p = toSource(e.clientX - box.left, e.clientY - box.top, rect);
      const delta = { x: p.x - d.origin.x, y: p.y - d.origin.y };
      const ratio = ratioFor(aspect, view);

      if (d.mode === 'move') {
        setCrop({
          x: d.startCrop.x + delta.x,
          y: d.startCrop.y + delta.y,
          w: d.startCrop.w,
          h: d.startCrop.h,
        });
      } else if (d.mode === 'resize') {
        setCrop(
          resizeCrop(d.handle, d.startCrop, delta, ratio, e.altKey, view.width, view.height)
        );
      } else if (d.mode === 'draw') {
        // Drawing a fresh rectangle from an empty area of the stage.
        let w = Math.abs(delta.x);
        let h = Math.abs(delta.y);
        if (ratio) {
          if (w / h > ratio) h = w / ratio;
          else w = h * ratio;
        }
        const x = delta.x < 0 ? d.origin.x - w : d.origin.x;
        const y = delta.y < 0 ? d.origin.y - h : d.origin.y;
        setCrop(normalizeCrop({ x, y, w, h }, view.width, view.height));
      }
    };

    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, aspect, view, rect, setCrop, containerRef]);

  if (!crop || !rect.width) return null;

  const box = toScreen(crop, rect);
  const showGuides = dragging;

  return (
    <div
      className="absolute inset-0"
      style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
      onPointerDown={(e) => onPointerDown(e, 'draw')}
      onDoubleClick={resetCrop}
    >
      {/* Dim everything outside the crop. Four panels rather than a box-shadow
          so the edges stay crisp at any zoom. */}
      <div className="pointer-events-none absolute bg-black/55" style={{
        left: rect.left, top: rect.top, width: rect.width, height: box.top - rect.top }} />
      <div className="pointer-events-none absolute bg-black/55" style={{
        left: rect.left, top: box.top + box.height,
        width: rect.width, height: rect.top + rect.height - (box.top + box.height) }} />
      <div className="pointer-events-none absolute bg-black/55" style={{
        left: rect.left, top: box.top, width: box.left - rect.left, height: box.height }} />
      <div className="pointer-events-none absolute bg-black/55" style={{
        left: box.left + box.width, top: box.top,
        width: rect.left + rect.width - (box.left + box.width), height: box.height }} />

      {/* The rectangle */}
      <div
        className="absolute border border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height, cursor: 'move' }}
        onPointerDown={(e) => onPointerDown(e, 'move')}
        onDoubleClick={(e) => { e.stopPropagation(); resetCrop(); }}
      >
        {showGuides && (
          <>
            <div className="pointer-events-none absolute inset-y-0 border-l border-white/25" style={{ left: '33.333%' }} />
            <div className="pointer-events-none absolute inset-y-0 border-l border-white/25" style={{ left: '66.666%' }} />
            <div className="pointer-events-none absolute inset-x-0 border-t border-white/25" style={{ top: '33.333%' }} />
            <div className="pointer-events-none absolute inset-x-0 border-t border-white/25" style={{ top: '66.666%' }} />
          </>
        )}

        {HANDLES.map((h) => {
          const style = { cursor: CURSORS[h] };
          if (h.includes('n')) style.top = -5;
          if (h.includes('s')) style.bottom = -5;
          if (h.includes('w')) style.left = -5;
          if (h.includes('e')) style.right = -5;
          if (h === 'n' || h === 's') { style.left = '50%'; style.marginLeft = -5; }
          if (h === 'e' || h === 'w') { style.top = '50%'; style.marginTop = -5; }
          return (
            <div
              key={h}
              className="absolute h-2.5 w-2.5 border border-neutral-900 bg-amber-400"
              style={style}
              onPointerDown={(e) => onPointerDown(e, 'resize', h)}
            />
          );
        })}
      </div>
    </div>
  );
}

export { MIN_CROP };
