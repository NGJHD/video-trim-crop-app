import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import CropRail from './components/CropRail.jsx';
import Stage from './components/Stage.jsx';
import TimelineBar from './components/TimelineBar.jsx';
import OutputBar from './components/OutputBar.jsx';
import DropZone from './components/DropZone.jsx';
import AboutDialog from './components/AboutDialog.jsx';

export default function App() {
  const videoRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const phase = useStore((s) => s.phase);
  const media = useStore((s) => s.media);
  const loadFile = useStore((s) => s.loadFile);
  const applyProgress = useStore((s) => s.applyProgress);

  useEffect(() => window.api.onProgress(applyProgress), [applyProgress]);

  // A path on the command line (Windows "Open with", or dragging a video onto
  // the exe) loads straight away.
  useEffect(() => {
    let cancelled = false;
    window.api.initialFile().then((res) => {
      if (!cancelled && res.ok && res.value) loadFile(res.value);
    });
    return () => { cancelled = true; };
  }, [loadFile]);

  const openDialog = useCallback(async () => {
    const res = await window.api.chooseFile();
    if (res.ok && res.value) loadFile(res.value);
  }, [loadFile]);

  // The WHOLE window is the drop target, not just the dashed box.
  useEffect(() => {
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) setDragOver(true);
    };
    const onDragLeave = (e) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const p = window.api.pathForFile(file);
      if (p) loadFile(p);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadFile]);

  // Keyboard map. The transport buttons we removed all live here instead.
  useEffect(() => {
    const onKey = (e) => {
      const s = useStore.getState();
      const el = videoRef.current;
      const typing = ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);

      // The About dialog is modal: nothing behind it should be listening.
      if (aboutOpen) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openDialog();
        return;
      }
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (s.phase === 'ready' && !s.job) s.render();
        return;
      }
      if (e.key === 'Escape') {
        if (s.job) { e.preventDefault(); s.cancelJob(); }
        return;
      }
      if (typing || s.phase !== 'ready' || !el) return;

      const frame = s.media?.fps ? 1 / s.media.fps : 1 / 30;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (el.paused) el.play().catch(() => {}); else el.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          el.currentTime = Math.max(0, el.currentTime - (e.shiftKey ? 1 : frame));
          break;
        case 'ArrowRight':
          e.preventDefault();
          el.currentTime = Math.min(s.media.duration, el.currentTime + (e.shiftKey ? 1 : frame));
          break;
        case 'Home':
          e.preventDefault();
          el.currentTime = s.trimStart;
          break;
        case 'End':
          e.preventDefault();
          el.currentTime = s.trimEnd;
          break;
        case 'i': case 'I':
          e.preventDefault();
          s.setTrimStart(el.currentTime);
          break;
        case 'o': case 'O':
          e.preventDefault();
          s.setTrimEnd(el.currentTime);
          break;
        case 'l': case 'L':
          e.preventDefault();
          s.toggleLoop();
          break;
        case 'r': case 'R':
          e.preventDefault();
          s.resetCrop();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDialog, aboutOpen]);

  return (
    <div
      className={
        'flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200 ' +
        (dragOver ? 'ring-2 ring-inset ring-amber-500' : '')
      }
    >
      <div className="flex min-h-0 flex-1">
        {media && <CropRail onAbout={() => setAboutOpen(true)} />}
        {media
          ? <Stage videoRef={videoRef} />
          : <DropZone onChoose={openDialog} onAbout={() => setAboutOpen(true)} />}
      </div>

      {media && <TimelineBar videoRef={videoRef} />}
      <OutputBar />

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
