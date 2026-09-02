# Video Trim & Crop

A self-contained Windows desktop app for trimming and cropping a single video
file. Drop a video in, drag a crop rectangle, set in/out points, hit Process.

Design rationale lives in [CLAUDE.md](CLAUDE.md); the UI is specified in
[UI.md](UI.md).

---

## Using it

1. Drop a video onto the window (or `Ctrl+O`, or pass a path on the command
   line — Windows "Open with" works).
2. Pick an aspect mode in the left rail and drag the crop rectangle. If the clip
   is oriented wrongly, fix it with **Rotate** underneath.
3. Set the trim range: **drag across the filmstrip** to select a span, drag the
   two handles to adjust it, or right-click for *Set trim start / end here*. A
   plain click just moves the playhead. **Reset trim** in the left rail selects
   the whole clip again.
4. Choose an output path and quality if you don't want the defaults, then
   **Process**.

The output goes next to the source as `<name>_trimmed.mp4`, and never
overwrites: a second render becomes `_trimmed_1`, `_trimmed_2`, and so on.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step one frame · `Shift` = 1 s |
| `Home` / `End` | Jump to the in / out point |
| `I` / `O` | Set in / out at the playhead |
| `L` | Toggle loop |
| `R` | Reset crop |
| Click filmstrip | Move the playhead |
| Drag across filmstrip | Select a trim range |
| Right-click filmstrip | Set trim start / end at that frame |
| Drag the white handle | Scrub the playhead |
| Right-click the handle | Set trim start / end at the playhead |
| `Ctrl+O` | Open a file |
| `Ctrl+Enter` | Process |
| `Esc` | Cancel the running job |

### Things worth knowing

- **The output is never scaled.** The crop rectangle *is* the output
  resolution, 1:1. Crop a 200 × 200 square out of a 4K clip and you get a
  200 × 200 file.
- **HDR is handled.** Phone footage recorded in HLG HDR (Samsung, recent
  Android) is tone-mapped to BT.709 on output. Without that the result looks
  flat and dull in most players. SDR sources are left alone.
- **Rotation is handled two ways.** A portrait clip that reports 1920 × 1080
  with a 90° rotation is treated as 1080 × 1920 automatically. Separately, if a
  phone wrote the *wrong* orientation, the **Rotate** control (none / 90 / 180 /
  270, clockwise) corrects it — the preview rotates instantly and the render
  matches. Changing it resets the crop, since the frame changes shape.
- **Quality** is High by default (`crf 17`, `preset slow` — visually
  transparent). Medium and Low trade quality for a smaller file.
- Output is H.264 / AAC in MP4 with `+faststart`.

---

## Development

```bash
npm install
node node_modules/electron/install.js   # see note below
npm run fetch-ffmpeg                    # downloads the bundled binaries
npm run dev
```

> **Note on `npm install`.** If npm blocks lifecycle scripts (it prints
> `allow-scripts` warnings), Electron's binary never downloads and `npm run dev`
> fails with `Error: Electron uninstall`. Either run
> `node node_modules/electron/install.js` as above, or
> `npm approve-scripts electron`.

`npm run dev` doesn't forward extra arguments. To open a file on launch during
development, run the built app directly:

```bash
npm run build
npx electron . "C:\path\to\clip.mp4"
```

### FFmpeg binaries

**Users never deal with this** — the released zip already contains FFmpeg. It
only matters when building from source.

`resources/bin/ffmpeg.exe` and `ffprobe.exe` are **not in git**, and can't be:
they are ~140 MB each and GitHub hard-rejects any file over 100 MB. One command
fetches them:

```bash
npm run fetch-ffmpeg
```

That downloads a static win64 **GPL** build (x264 is required by the render
spec), checks it actually provides `libx264`, `zscale`, `tonemap` and `aac` —
a build without `zscale` would break HDR output in a way that's easy to miss —
and only then moves it into `resources/bin/`. Any recent GPL full build works
if you'd rather supply your own.

They are never resolved from the system `PATH`, and the app refuses to start
with a clear message if they're missing.

### App icon

`build/icon.png` is the 1024 x 1024 master. `build/icon.ico` is generated from
it and is what Windows actually uses:

```bash
node scripts/make-icon.mjs
```

It writes a genuine multi-resolution icon (16, 24, 32, 48, 64, 128, 256).
electron-builder would happily convert the PNG on its own, but only at one size,
which leaves a blurry rescale everywhere Windows asks for a different one — the
taskbar, alt-tab, Explorer tiles and the exe thumbnail all differ. Re-run the
script after replacing `icon.png`.

### Verification

```bash
npm run verify
```

55 checks covering crop geometry, letterbox mapping, rotation, quality presets,
filter-chain construction and FFmpeg argument building — then, against real
footage, which it looks for in `./samples`, then `$VTC_SAMPLES`, then a
directory passed as an argument:

- display dimensions are the coded dimensions swapped for rotated clips;
- **the rotation test CLAUDE.md §6 requires** — all four corners cropped through
  the video pipeline match the same corners cropped out of the already-rotated
  frame, which is what makes display-space coordinates valid;
- an end-to-end render through the app's own argument builder lands on the
  requested corner, at exactly the crop dimensions, re-tagged BT.709;
- a manual 90° rotation swaps the output axes, and a crop taken in that rotated
  space lands on the region the user framed.

Skips the footage checks gracefully if no samples are present.

### Packaging — no installation

```bash
npm run pack   # unpacked directory, for testing
npm run dist   # zip in release/
```

**There is no installer.** `npm run dist` produces a single artifact:

```
release/Video Trim & Crop-<version>-x64.zip     ~300 MB
```

Unzip anywhere, double-click `Video Trim & Crop.exe` inside. Nothing is
installed, nothing needs admin rights, nothing is written to the registry, and
nothing is left behind when the folder is deleted. This is the GitHub release
artifact.

`release/` is not cleaned between builds, so delete it first (or check the
timestamps) to avoid shipping a stale zip.

The FFmpeg binaries are copied to `resources/bin` next to `app.asar` rather than
inside it — files inside an asar archive cannot be executed, which is a failure
that only appears after packaging. Both packaged forms are tested by launching
the built exe and rendering a real clip.

---

## Layout

```
src/
  shared/      ipc.js       channel names + payload shapes, imported by both sides
               filters.js   FFmpeg filter chains and argument arrays
  main/        index.js     app lifecycle, window, IPC handlers
               binaries.js  bundled binary resolution + startup assertion
               probe.js     ffprobe -> MediaInfo (the ONLY place raw w/h is read)
               media.js     proxy, filmstrip, render
               jobs.js      child process registry, progress parsing, cancellation
               temp.js      temp lifecycle, output path selection
  preload/     index.js     the entire window.api surface
  renderer/    src/App.jsx, store.js, components/, lib/
scripts/       verify.mjs        55 checks, incl. real-footage rotation tests
               make-icon.mjs     build/icon.png -> multi-size build/icon.ico
               fetch-ffmpeg.mjs  downloads + validates the bundled binaries
build/         icon.png, icon.ico
```

The renderer has no `fs`, no `child_process` and no FFmpeg; everything from disk
goes through IPC. `contextIsolation` is on, `nodeIntegration` off.

---

## Licensing

This project's source is **MIT** (`LICENSE`).

The distributed app also bundles **FFmpeg, which is GPL v3** and is not covered
by the MIT licence. The app spawns `ffmpeg.exe` as a separate process rather
than linking it, which is why this codebase can stay MIT while the binaries
keep their own licence.

If you distribute the zip, there are obligations — keeping the notices in the
folder and pointing at the FFmpeg source. They're short and spelled out in
**[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**.
