import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CH } from '../shared/ipc.js';

/**
 * The entire renderer-facing surface. The renderer has no fs, no child_process
 * and no FFmpeg — everything from disk comes through here.
 */
const api = {
  probe: (filePath) => ipcRenderer.invoke(CH.MEDIA_PROBE, filePath),
  makeProxy: (opts) => ipcRenderer.invoke(CH.MEDIA_PROXY, opts),
  makeFilmstrip: (opts) => ipcRenderer.invoke(CH.MEDIA_FILMSTRIP, opts),
  process: (req) => ipcRenderer.invoke(CH.MEDIA_PROCESS, req),
  cancel: (jobId) => ipcRenderer.invoke(CH.MEDIA_CANCEL, jobId),
  release: () => ipcRenderer.invoke(CH.MEDIA_RELEASE),

  suggestOutput: (srcPath) => ipcRenderer.invoke(CH.OUTPUT_SUGGEST, srcPath),
  chooseOutput: (defaultPath) => ipcRenderer.invoke(CH.OUTPUT_CHOOSE, defaultPath),
  chooseFile: () => ipcRenderer.invoke(CH.FILE_CHOOSE),
  initialFile: () => ipcRenderer.invoke(CH.FILE_INITIAL),
  reveal: (filePath) => ipcRenderer.invoke(CH.FILE_REVEAL, filePath),
  setTitle: (title) => ipcRenderer.invoke(CH.WINDOW_TITLE, title),

  /**
   * Chromium no longer exposes File.path, so the absolute path of a dropped
   * file has to come from webUtils in the preload.
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },

  onProgress: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(CH.JOB_PROGRESS, fn);
    return () => ipcRenderer.removeListener(CH.JOB_PROGRESS, fn);
  },
};

contextBridge.exposeInMainWorld('api', api);
