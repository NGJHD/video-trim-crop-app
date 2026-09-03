import { useStore } from '../store.js';
import { ASPECTS, isFullFrame } from '../lib/crop.js';
import { ROTATIONS } from '@shared/ipc.js';
import InfoIcon from './InfoIcon.jsx';

function Radio({ label, active, disabled, onClick, title }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={
        'flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13px] transition-colors ' +
        'disabled:cursor-default disabled:opacity-40 ' +
        (active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/60')
      }
    >
      <span
        className={
          'h-2.5 w-2.5 shrink-0 rounded-full border ' +
          (active ? 'border-amber-400 bg-amber-400' : 'border-neutral-600')
        }
      />
      {label}
    </button>
  );
}

function Heading({ children }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
      {children}
    </h2>
  );
}

/**
 * The left rail: aspect mode, reset, and manual rotation. No coordinate
 * readouts — the rectangle on the video already says where the crop is.
 */
export default function CropRail({ onAbout }) {
  const aspect = useStore((s) => s.aspect);
  const setAspect = useStore((s) => s.setAspect);
  const resetCrop = useStore((s) => s.resetCrop);
  const rotation = useStore((s) => s.rotation);
  const setRotation = useStore((s) => s.setRotation);
  const resetTrim = useStore((s) => s.resetTrim);
  const ready = useStore((s) => s.phase === 'ready');

  // Both reset buttons disable themselves when there is nothing to undo, so
  // each control reflects whether it would actually do anything.
  const cropIsFull = useStore((s) => !!s.crop && !!s.view.width && isFullFrame(s.crop, s.view));
  const trimIsFull = useStore(
    (s) => s.trimStart <= 0.001 && !!s.media && s.trimEnd >= s.media.duration - 0.001
  );

  return (
    <aside className="flex w-[200px] shrink-0 flex-col overflow-y-auto border-r border-neutral-800
                      bg-neutral-900 p-4">
      <Heading>Crop</Heading>
      <div className="flex flex-col gap-1">
        {ASPECTS.map((a) => (
          <Radio
            key={a.id}
            label={a.label}
            active={aspect === a.id}
            disabled={!ready}
            onClick={() => setAspect(a.id)}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={!ready || cropIsFull}
        onClick={resetCrop}
        className="mt-3 rounded border border-neutral-700 px-2 py-1.5 text-[13px] text-neutral-300
                   transition-colors hover:border-neutral-600 hover:bg-neutral-800
                   disabled:cursor-default disabled:opacity-40"
        title={cropIsFull ? 'Already the whole frame' : 'Crop the whole frame again'}
      >
        Reset crop
      </button>

      {/* Manual rotation, for footage whose phone wrote the wrong display
          matrix. Applied to the preview instantly and to the render as a
          matching transpose filter. */}
      <div className="mt-6 border-t border-neutral-800 pt-4">
        <Heading>Rotate</Heading>
        <div className="flex flex-col gap-1">
          {ROTATIONS.map((r) => (
            <Radio
              key={r.id}
              label={r.label}
              active={rotation === r.id}
              disabled={!ready}
              onClick={() => setRotation(r.id)}
              title={r.id ? `${r.id}° clockwise` : 'Use the file’s own orientation'}
            />
          ))}
        </div>
        {rotation !== 0 && (
          <p className="mt-2 px-2 text-[11px] leading-snug text-neutral-600">
            Crop reset — the frame changed shape.
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-neutral-800 pt-4">
        <Heading>Trim</Heading>
        <button
          type="button"
          disabled={!ready || trimIsFull}
          onClick={resetTrim}
          className="w-full rounded border border-neutral-700 px-2 py-1.5 text-[13px] text-neutral-300
                     transition-colors hover:border-neutral-600 hover:bg-neutral-800
                     disabled:cursor-default disabled:opacity-40"
          title={trimIsFull ? 'Already the full clip' : 'Select the whole clip again'}
        >
          Reset trim
        </button>
      </div>

      {/* Pinned to the bottom of the rail. mt-auto rather than a fixed
          position, so it sits under the last section however tall they get and
          scrolls with them on a short window.

          Styled as a button, not a text link: as plain text it read as a label
          and nobody tried clicking it. The icon keeps it distinct from the two
          reset buttons above, which are a different kind of thing. */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={onAbout}
          className="flex w-full items-center justify-center gap-1.5 rounded border
                     border-neutral-700 px-2 py-1.5 text-[13px] text-neutral-300
                     transition-colors hover:border-neutral-600 hover:bg-neutral-800"
          title="Version, source and updates"
        >
          <InfoIcon />
          About
        </button>
      </div>
    </aside>
  );
}
