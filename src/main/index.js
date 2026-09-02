import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { assertBinaries, iconPathIfPresent } from './binaries.js';
import { probeMedia } from './probe.js';
import { sweepTemp, suggestOutputPath } from './temp.js';
import { rememberFolder, startFolder } from './settings.js';
import { remuxProxy, transcodeProxy, buildFilmstrip, renderOutput } from './media.js';
import { cancelJob, cancelAllJobs, newJobId } from './jobs.js';
import { CH, STAGE } from '../shared/ipc.js';

let mainWindow = null;

/**
 * A file path handed to the app on the command line, so Windows "Open with"
 * and dragging a video onto the exe both work.
 *   Video Trim & Crop.exe "C:\clips\holiday.mp4"
 *   npm run dev -- --open="C:\clips\holiday.mp4"
 */
function initialFileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    const candidate = arg.startsWith('--open=') ? arg.slice(7) : arg;
    if (candidate !== arg || (!arg.startsWith('-') && arg !== '.')) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* not a usable path */
      }
    }
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#171717',
    title: 'Video Trim & Crop',
    icon: iconPathIfPresent(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // The renderer sets the title to include file metadata, so don't let the
  // document's own <title> fight it.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Kill any in-flight ffmpeg before the window goes away.
  mainWindow.on('close', () => cancelAllJobs());

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

/** Wrap a handler so every failure reaches the renderer with its stderr tail. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      return {
        ok: false,
        cancelled: Boolean(err?.cancelled),
        message: err?.message || String(err),
        ffmpegTail: err?.ffmpegTail || '',
      };
    }
  });
}

function registerHandlers() {
  handle(CH.MEDIA_PROBE, async (_e, filePath) => {
    const info = await probeMedia(filePath);
    // Every successful load passes through here, however the file arrived —
    // a drop, the dialog, or the command line — so this is the one place that
    // needs to remember where it came from.
    rememberFolder(path.dirname(filePath));
    return info;
  });

  handle(CH.MEDIA_PROXY, async (event, { srcPath, duration, mode }) => {
    const sender = event.sender;
    return mode === 'remux'
      ? remuxProxy({ srcPath, sender })
      : transcodeProxy({ srcPath, duration, sender });
  });

  handle(CH.MEDIA_FILMSTRIP, async (event, opts) => {
    // One ffmpeg pass now, so it reports its own progress on job:progress.
    const files = await buildFilmstrip({
      ...opts,
      jobId: opts.jobId || newJobId(),
      sender: event.sender,
    });
    return { files };
  });

  handle(CH.MEDIA_PROCESS, async (event, req) => {
    const jobId = req.jobId || newJobId();
    const outputPath = await renderOutput({ req, jobId, sender: event.sender });
    let size = 0;
    try {
      size = fs.statSync(outputPath).size;
    } catch {
      /* reported as 0 */
    }
    return { outputPath, size };
  });

  handle(CH.MEDIA_CANCEL, (_e, jobId) => cancelJob(jobId));

  handle(CH.MEDIA_RELEASE, () => {
    cancelAllJobs();
    sweepTemp();
    return true;
  });

  handle(CH.OUTPUT_SUGGEST, (_e, srcPath) => suggestOutputPath(srcPath));

  handle(CH.OUTPUT_CHOOSE, async (_e, defaultPath) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save trimmed video as',
      defaultPath,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return res.canceled ? null : res.filePath;
  });

  handle(CH.FILE_CHOOSE, async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a video',
      defaultPath: startFolder(),
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'ts', 'm4v', 'mts', 'm2ts', 'flv', 'wmv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  handle(CH.FILE_INITIAL, () => initialFileFromArgv(process.argv));

  handle(CH.FILE_REVEAL, (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  handle(CH.WINDOW_TITLE, (_e, title) => {
    mainWindow?.setTitle(title || 'Video Trim & Crop');
    return true;
  });
}

app.whenReady().then(() => {
  if (!assertBinaries()) {
    app.quit();
    return;
  }
  // Windows groups taskbar buttons and picks their icon by AppUserModelID.
  // Without this the app can inherit the generic Electron identity and show
  // the wrong icon in the taskbar even when the exe itself is correct.
  app.setAppUserModelId('com.darrenng.videotrimcrop');

  // No application menu: the title bar carries the file metadata and the
  // shortcuts are all handled in the renderer.
  Menu.setApplicationMenu(null);

  // Catch anything a previous crash left behind.
  sweepTemp();
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Belt and braces: no orphaned ffmpeg.exe, and no gigabytes left in temp.
app.on('will-quit', () => {
  cancelAllJobs();
  sweepTemp();
});
