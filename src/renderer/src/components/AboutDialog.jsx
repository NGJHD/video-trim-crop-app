import { useCallback, useEffect, useRef, useState } from 'react';
import { fileSize } from '../lib/format.js';

/**
 * About, and the one place the app updates itself from.
 *
 * The update runs in the main process; this is a status readout with two
 * buttons. Every failure arrives as a sentence worth showing — the updater
 * never returns a bare "failed".
 */

/** idle → checking → uptodate | available | error, then available → working. */
const IDLE = 'idle';

export default function AboutDialog({ onClose }) {
  const [info, setInfo] = useState(null);
  const [state, setState] = useState(IDLE);
  const [message, setMessage] = useState('');
  const [release, setRelease] = useState(null);
  const [progress, setProgress] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    let live = true;
    window.api.about().then((res) => {
      if (live && res.ok) setInfo(res.value);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => window.api.onUpdateProgress(setProgress), []);

  // Escape closes, and is swallowed here so it never reaches the editor's own
  // keyboard map underneath.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (state !== 'working') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, state]);

  // Focus the panel rather than the close button: a ring around ✕ reads as
  // "this is the action", which it is not.
  useEffect(() => { panelRef.current?.focus(); }, []);

  const check = useCallback(async () => {
    setState('checking');
    setMessage('');
    setRelease(null);

    const res = await window.api.checkUpdate();
    if (!res.ok) {
      setState('error');
      setMessage(res.message);
      return;
    }

    setRelease(res.value);
    if (res.value.newer) {
      setState('available');
    } else {
      setState('uptodate');
      setMessage(`Version ${res.value.current} is the latest.`);
    }
  }, []);

  const install = useCallback(async () => {
    setState('working');
    setMessage('');
    setProgress({ phase: 'download', percent: 0, received: 0, total: release.assetSize });

    const res = await window.api.installUpdate(release);
    if (!res.ok) {
      // On success the app is already on its way out, so only a failure ever
      // gets this far.
      setState(res.cancelled ? 'available' : 'error');
      setMessage(res.cancelled ? '' : res.message);
      setProgress(null);
    }
  }, [release]);

  const openRepo = useCallback(() => {
    if (info) window.api.openLink(info.repoUrl);
  }, [info]);

  const busy = state === 'working';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="About Video Trim & Crop"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[480px] max-w-full rounded-lg border border-neutral-800 bg-neutral-900
                   shadow-2xl outline-none"
      >
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <div className="mt-0.5 text-2xl text-amber-500" aria-hidden>▣</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-neutral-100">
              {info?.appName ?? 'Video Trim & Crop'}
            </h2>
            <p className="text-[12px] text-neutral-500">
              Trim and crop a single video file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="-mr-1 shrink-0 rounded px-2 py-1 text-[13px] text-neutral-500
                       hover:text-neutral-200 disabled:cursor-default disabled:opacity-30"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <dl className="grid grid-cols-[92px_1fr] gap-x-4 gap-y-2.5 px-5 py-4 text-[13px]">
          <dt className="text-neutral-500">Made by</dt>
          <dd className="text-neutral-200">{info?.author ?? '—'}</dd>

          <dt className="text-neutral-500">Version</dt>
          <dd className="tabular-nums text-neutral-200">
            {info?.version ?? '—'}
            {info && !info.canInstall && (
              <span className="ml-2 text-[11px] text-neutral-600">development build</span>
            )}
          </dd>

          <dt className="text-neutral-500">Source</dt>
          <dd className="min-w-0">
            <button
              type="button"
              onClick={openRepo}
              disabled={!info}
              className="max-w-full truncate text-left text-amber-500 underline decoration-amber-500/40
                         underline-offset-2 hover:text-amber-400 hover:decoration-amber-400
                         disabled:opacity-40"
              title="Open the repository on GitHub"
            >
              {info ? info.repoUrl.replace('https://', '') : '—'}
            </button>
          </dd>
        </dl>

        <section className="border-t border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={state === 'available' ? install : check}
              disabled={busy || state === 'checking'}
              className={
                'shrink-0 rounded px-4 py-1.5 text-[13px] font-semibold transition-colors ' +
                'disabled:cursor-default disabled:bg-neutral-800 disabled:text-neutral-600 ' +
                (state === 'available'
                  ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400'
                  : 'border border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800')
              }
            >
              {state === 'checking'
                ? 'Checking…'
                : state === 'available'
                  ? `Update to ${release.version}`
                  : 'Check for updates'}
            </button>

            {/* Only the download is abortable — once unpacking starts there is
                nothing left to stop, so the button goes rather than lie. */}
            {busy && progress?.phase === 'download' && (
              <button
                type="button"
                onClick={() => window.api.cancelUpdate()}
                className="shrink-0 rounded border border-neutral-700 px-3 py-1.5 text-[12px]
                           text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800"
              >
                Cancel
              </button>
            )}

            <p
              className={
                'min-w-0 flex-1 text-[12px] leading-snug ' +
                (state === 'error' ? 'text-red-400' : 'text-neutral-500')
              }
            >
              {state === 'available' && release
                ? `Version ${release.version} is available (${fileSize(release.assetSize)}).`
                : message}
            </p>
          </div>

          {state === 'available' && (
            <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
              The app will download it, close, replace itself and start again. Any video you
              have loaded is not touched — but finish whatever is processing first.
            </p>
          )}

          {busy && progress && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-amber-500 transition-[width] duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, progress.percent || 0))}%` }}
                />
              </div>
              <p className="mt-1.5 text-[12px] tabular-nums text-neutral-500">
                {progress.phase === 'extract'
                  ? 'Unpacking…'
                  : `Downloading — ${fileSize(progress.received)} of ${fileSize(progress.total)}`}
              </p>
            </div>
          )}

          {state === 'error' && info && (
            <button
              type="button"
              onClick={() => window.api.openLink(info.releasesUrl)}
              className="mt-3 text-[12px] text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
            >
              Open the releases page instead
            </button>
          )}
        </section>

        <footer className="border-t border-neutral-800 px-5 py-3 text-[11px] leading-relaxed text-neutral-600">
          MIT licensed. Bundles unmodified FFmpeg (GPL v3) — see
          THIRD-PARTY-NOTICES.md in the app folder.
          {info && (
            <span className="ml-1 tabular-nums">Electron {info.electron}.</span>
          )}
        </footer>
      </div>
    </div>
  );
}
