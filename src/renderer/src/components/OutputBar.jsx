import { useState } from 'react';
import { useStore } from '../store.js';
import { QUALITY } from '@shared/ipc.js';
import { shortPath, basename, fileSize, eta } from '../lib/format.js';

/**
 * The bottom bar. One slot, five faces: idle, importing/rendering, success,
 * error, and the long-import confirm strip.
 */
export default function OutputBar() {
  const job = useStore((s) => s.job);
  const error = useStore((s) => s.error);
  const success = useStore((s) => s.success);
  const notice = useStore((s) => s.notice);
  const importConfirm = useStore((s) => s.importConfirm);
  const media = useStore((s) => s.media);

  if (error) return <ErrorFace />;
  if (importConfirm) return <ConfirmFace />;
  if (job) return <ProgressFace />;
  if (success) return <SuccessFace />;

  // Nothing loaded and nothing to report: no bar at all. An empty window
  // shouldn't be showing a disabled Process button and an output path field.
  if (!media) return null;

  return <IdleFace notice={notice} />;
}

function Bar({ children, tone = 'default' }) {
  const border =
    tone === 'error' ? 'border-red-900/70' : tone === 'success' ? 'border-green-900/70' : 'border-neutral-800';
  return (
    <div className={`shrink-0 border-t ${border} bg-neutral-900 px-4 py-2.5`}>{children}</div>
  );
}

function IdleFace({ notice }) {
  const media = useStore((s) => s.media);
  const crop = useStore((s) => s.crop);
  const trimStart = useStore((s) => s.trimStart);
  const trimEnd = useStore((s) => s.trimEnd);
  const outputPath = useStore((s) => s.outputPath);
  const removeAudio = useStore((s) => s.removeAudio);
  const setRemoveAudio = useStore((s) => s.setRemoveAudio);
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const chooseOutput = useStore((s) => s.chooseOutput);
  const render = useStore((s) => s.render);
  const ready = useStore((s) => s.phase === 'ready');

  const selection = trimEnd - trimStart;
  const canRender = ready && outputPath && selection > 0.05;

  return (
    <Bar>
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="truncate text-[13px] text-neutral-300"
            title={outputPath || undefined}
          >
            {outputPath ? shortPath(outputPath, 58) : 'No file loaded'}
          </span>
          <button
            type="button"
            disabled={!ready}
            onClick={chooseOutput}
            className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[12px] text-neutral-300
                       transition-colors hover:border-neutral-600 hover:bg-neutral-800
                       disabled:cursor-default disabled:opacity-40"
          >
            Change…
          </button>

          {ready && crop && (
            // Output size and duration, updating live. This is a readout of the
            // crop rectangle, not a setting — nothing scales the output.
            <span className="hidden shrink-0 text-[12px] tabular-nums text-neutral-500 lg:inline">
              {crop.w} × {crop.h} · {selection.toFixed(2)} s
            </span>
          )}
        </div>

        {notice && (
          <span className="shrink-0 text-[12px] text-amber-400">{notice}</span>
        )}

        <label
          className={
            'flex shrink-0 items-center gap-2 text-[12px] ' +
            (ready && media?.hasAudio ? 'cursor-pointer text-neutral-400' : 'text-neutral-600')
          }
          title={media && !media.hasAudio ? 'This file has no audio track' : undefined}
        >
          <input
            type="checkbox"
            checked={removeAudio}
            disabled={!ready || !media?.hasAudio}
            onChange={(e) => setRemoveAudio(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          {media && !media.hasAudio ? 'no audio track' : 'remove audio'}
        </label>

        <label className="flex shrink-0 items-center gap-2 text-[12px] text-neutral-400">
          <span className="hidden xl:inline">Quality</span>
          <select
            value={quality}
            disabled={!ready}
            onChange={(e) => setQuality(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[12px]
                       text-neutral-200 outline-none transition-colors hover:border-neutral-600
                       focus:border-amber-500 disabled:opacity-40"
            title="High is visually transparent; lower settings trade quality for a smaller file"
          >
            {Object.values(QUALITY).map((q) => (
              <option key={q.id} value={q.id}>{q.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={!canRender}
          onClick={render}
          className="shrink-0 rounded bg-amber-500 px-5 py-1.5 text-[13px] font-semibold text-neutral-950
                     transition-colors hover:bg-amber-400
                     disabled:cursor-default disabled:bg-neutral-800 disabled:text-neutral-600"
          title="Process (Ctrl+Enter)"
        >
          Process
        </button>
      </div>
    </Bar>
  );
}

function ProgressFace() {
  const job = useStore((s) => s.job);
  const cancelJob = useStore((s) => s.cancelJob);
  const percent = Math.max(0, Math.min(100, job.percent || 0));

  return (
    <Bar>
      <div className="flex items-center gap-4">
        <span className="w-40 shrink-0 text-[13px] text-neutral-300">{job.label}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full bg-amber-500 transition-[width] duration-150"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-neutral-400">
          {percent.toFixed(0)} %
        </span>
        <span className="w-32 shrink-0 text-right text-[12px] tabular-nums text-neutral-500">
          {job.etaSeconds != null ? eta(job.etaSeconds) : ''}
        </span>
        <button
          type="button"
          onClick={cancelJob}
          className="shrink-0 rounded border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300
                     transition-colors hover:border-neutral-600 hover:bg-neutral-800"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
      </div>
    </Bar>
  );
}

function SuccessFace() {
  const success = useStore((s) => s.success);
  const clearSuccess = useStore((s) => s.clearSuccess);

  return (
    <Bar tone="success">
      <div className="flex items-center gap-3">
        <span className="text-green-400">✓</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-200">
          Saved <b className="font-semibold">{basename(success.outputPath)}</b>
          <span className="ml-2 tabular-nums text-neutral-500">
            {success.width} × {success.height} · {success.duration.toFixed(2)} s · {fileSize(success.size)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => window.api.reveal(success.outputPath)}
          className="shrink-0 rounded border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300
                     transition-colors hover:border-neutral-600 hover:bg-neutral-800"
        >
          Show in folder
        </button>
        <button
          type="button"
          onClick={clearSuccess}
          className="shrink-0 rounded px-2 py-1 text-[12px] text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>
    </Bar>
  );
}

function ErrorFace() {
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const [open, setOpen] = useState(false);

  return (
    <Bar tone="error">
      <div className="flex items-center gap-3">
        <span className="text-red-400">⚠</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-200">{error.message}</span>
        {error.ffmpegTail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300
                       transition-colors hover:border-neutral-600 hover:bg-neutral-800"
          >
            {open ? 'Hide' : 'Show'} FFmpeg output
          </button>
        )}
        {error.ffmpegTail && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(error.ffmpegTail)}
            className="shrink-0 rounded border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300
                       transition-colors hover:border-neutral-600 hover:bg-neutral-800"
          >
            Copy details
          </button>
        )}
        <button
          type="button"
          onClick={clearError}
          className="shrink-0 rounded px-2 py-1 text-[12px] text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>

      {/* The stderr tail is the whole diagnostic value — selectable, copyable,
          and never swallowed into a generic message. */}
      {open && error.ffmpegTail && (
        <pre className="mt-2 max-h-40 select-text overflow-auto rounded border border-neutral-800
                        bg-neutral-950 p-2 font-mono text-[11px] leading-relaxed text-neutral-400">
          {error.ffmpegTail}
        </pre>
      )}
    </Bar>
  );
}

function ConfirmFace() {
  const importConfirm = useStore((s) => s.importConfirm);
  const beginImport = useStore((s) => s.beginImport);
  const reset = useStore((s) => s.clearError);
  const minutes = Math.round(importConfirm.seconds / 60);
  const estimate = Math.max(1, Math.round(importConfirm.estimate / 60));

  return (
    <Bar>
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1 text-[13px] text-neutral-300">
          This {minutes}-minute clip can’t be played directly and needs about{' '}
          <b>{estimate} minute{estimate === 1 ? '' : 's'}</b> to prepare a preview.
        </span>
        <button
          type="button"
          onClick={() => beginImport(importConfirm.media, 3, importConfirm.mode)}
          className="shrink-0 rounded bg-amber-500 px-4 py-1.5 text-[13px] font-semibold text-neutral-950
                     hover:bg-amber-400"
        >
          Start
        </button>
        <button
          type="button"
          onClick={async () => {
            const res = await window.api.chooseFile();
            reset();
            if (res.ok && res.value) useStore.getState().loadFile(res.value);
            else useStore.setState({ importConfirm: null, phase: 'empty' });
          }}
          className="shrink-0 rounded border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-300
                     hover:border-neutral-600 hover:bg-neutral-800"
        >
          Choose another file
        </button>
      </div>
    </Bar>
  );
}
