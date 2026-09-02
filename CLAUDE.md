# CLAUDE.md — Video Trim & Crop

Guidance for Claude Code when working in this repository.

---

## 1. What this app is

A self-contained Windows 11 desktop app for **trimming and cropping a single video file**.

User flow:
1. Drag & drop a video onto the window.
2. Video loads into a preview player with play/pause and a seek bar.
3. User drags a crop rectangle over the video. Crop mode is one of:
   free-form, `1:1`, `3:2`, `16:9`, or `original` (source aspect ratio).
4. User sets a trim-start and trim-end marker on the timeline.
5. User hits **Process** → a new video file is written containing only the
   trimmed range, cropped to the selected rectangle.

---

## 2. Non-negotiable constraints

These come from the product owner. Do not propose alternatives that violate them.

- **Ships as a self-contained Windows exe.** The end user copies the folder, run the exe and it should work,
  nothing else — no separate FFmpeg install, no codec packs, no Python, no
  .NET runtime.
- **FFmpeg and ffprobe binaries are bundled with the app.** They are never
  resolved from the system `PATH`.
- **Output quality is reasonably high by default.** This app is not a compressor. A user
  trimming a 4K clip should get back something visually indistinguishable
  from the source.
- **All application code is Javascript.** No Rust, no C++, no Python helper
  scripts. This is deliberate: it keeps the codebase in one language with
  well-understood patterns.

---

## 3. Stack

| Layer | Choice |
| --- | --- |
| Shell | Electron (latest stable) |
| UI | React + Javascript |
| Build | Vite (via `electron-vite`) |
| Packaging | `electron-builder`, target NSIS + portable |
| Media | Bundled static `ffmpeg.exe` + `ffprobe.exe` (GPL build, x264 enabled) |
| State | React state / Zustand. No Redux. |
| Styling | Tailwind |

**Process model:**
- **Main process** — owns all FFmpeg/ffprobe execution, file I/O, temp file
  lifecycle. Never blocks; all child processes are spawned async.
- **Preload** — exposes a narrow, typed `window.api` surface via
  `contextBridge`. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer** — pure UI. Has **no** direct access to `fs`, `child_process`,
  or FFmpeg. If the renderer needs something from disk, it goes through IPC.

---

## 4. Architecture rules

### 4.1 IPC contract

Define all IPC channel names and payload types in a single shared file
(`src/shared/ipc.ts`) imported by both main and renderer. Never use string
literals for channel names at call sites.

Core channels:

```ts
'media:probe'      // (filePath) -> MediaInfo
'media:proxy'      // (filePath) -> starts proxy transcode, emits progress
'media:process'    // (ProcessRequest) -> starts final render, emits progress
'media:cancel'     // (jobId) -> kills the running ffmpeg child process
'job:progress'     // main -> renderer, { jobId, percent, stage }
'job:done'         // main -> renderer, { jobId, outputPath }
'job:error'        // main -> renderer, { jobId, message, ffmpegTail }
```

Long-running FFmpeg jobs must be **cancellable**. Keep a `Map<jobId, ChildProcess>`
in the main process and kill on cancel, on window close, and on app quit.
An orphaned ffmpeg.exe pegging the CPU after the app closes is a shipping blocker.

### 4.2 Errors

FFmpeg failures must surface the **last ~20 lines of stderr** to the renderer,
not a generic "processing failed". Most FFmpeg problems are diagnosable only
from stderr.

---

## 5. Import pipeline: probe, then decide

On drop, always run `ffprobe -v quiet -print_format json -show_streams -show_format`
first. Never guess from the file extension.

Extract and store: `codec_name`, `width`, `height`, `duration`, `r_frame_rate`,
`nb_frames`, rotation from the display matrix side data, `pix_fmt`, and audio
stream presence.

### 5.1 Three import tiers

The expected input for this app is **phone video**: short clips, usually
H.264/MP4 or HEVC/MP4 from an Android phone, very often portrait, and
increasingly 10-bit HLG HDR.

Pick the cheapest tier that works. Do not transcode when a remux will do.

**Never hardcode a codec support list.** Chromium's playable set is not fixed:
HEVC in particular decodes only when the machine has a hardware HEVC decoder
(roughly Intel HD4400+, NVIDIA GT635+, AMD RX460+), and standard Chromium and
Electron builds ship **no software HEVC fallback**. The same binary therefore
gives different answers on different machines, and the set grows as Chromium
adds codecs. A static table is guaranteed wrong somewhere. Ask the runtime
instead — see 5.1.1.

**Tier 1 — Direct play. No processing.**
The renderer decoded a frame from the original file. Point the `<video>`
element at it and do nothing else.

#### 5.1.1 Determining the tier — probe by trying

After ffprobe returns, hand the **original file** to a detached `<video>` and
wait for one decoded frame (`requestVideoFrameCallback`) with a short timeout.

- A frame arrives → **tier 1**.
- It errors, or times out → fall back, using ffprobe's `codec_name` and
  container to choose between tier 2 and tier 3.

Do this by actually loading the file, not via `canPlayType()` /
`MediaSource.isTypeSupported()`. Those answer `"probably"` / `"maybe"`, are
wrong in both directions often enough to matter, and using them means building
RFC 6381 codec strings (`hvc1.2.4.L120.B0`) out of ffprobe fields — fiddly and
easy to get subtly wrong. Loading the file is ground truth.

Cache the verdict per `codec_name/profile/pix_fmt` for the session so the
second clip off the same phone skips the probe.

The ffprobe codec list survives only as a **hint** for picking tier 2 vs tier 3
once playback has already failed. Being wrong there costs time, not
correctness.

**Tier 2 — Remux only.**
Codec is playable but the container is not (MKV, AVI, TS holding H.264/VP9/AV1).

```
ffmpeg -i <input> -c copy -movflags +faststart <temp>/proxy_<hash>.mp4
```

No decode, no encode — this is a container rewrite and runs at disk speed.
Cheap regardless of duration.

**Tier 3 — Transcode.**
The playback probe failed and a remux won't help: ProRes, MPEG-2, VC-1, or
HEVC on a machine with no hardware HEVC decoder.

**Tier 3 is a rare fallback, not the common path.** On any machine with a
2016-or-later GPU the expected HEVC phone footage lands in tier 1 and imports
instantly at any duration. Do not optimise the app around tier 3.

Rotation is **not** a tier selector. Rotated video plays correctly in all three
tiers — see section 6 for why.

### 5.2 Transcode proxy spec (tier 3 only)

```
ffmpeg -hwaccel auto -i <input> \
  -vf "scale=-2:720" \
  -c:v libx264 -preset veryfast -crf 23 \
  -g 24 -keyint_min 24 -sc_threshold 0 \
  -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  <temp>/proxy_<hash>.mp4
```

- `-hwaccel auto` uses GPU decode where available. This matters for 4K HEVC
  and is safe here because the proxy is preview-only — it never affects
  output quality.
- Short GOP (`-g 24`) is deliberate — it makes scrubbing responsive.
- Proxies and remuxes live in `app.getPath('temp')/video-trim-crop/` and are
  deleted on app quit and on loading a new file. Do not leak gigabytes into
  the user's temp folder.
- Show a determinate progress bar. Do not show a bare spinner.

### 5.3 Duration guard

Tier 3 cost scales with duration × resolution, and it is dominated by *decode*,
not encode — measured at ~6 s per minute of 1080p 10-bit HEVC even with
`-hwaccel auto`, so a full proxy runs at roughly 4–7× realtime.

Because tier 3 is now a rare fallback, the guard is a warning rather than
machinery: if a tier 3 source exceeds **4 minutes**, show the estimate and let
the user start or cancel, then run it behind a determinate bar whose ETA is
refined from measured throughput rather than a hardcoded constant. Do not build
segment-on-demand preview unless this warning starts firing regularly in real
use.

The filmstrip (section 5.4) is duration-independent and should be generated
first, so a long tier 3 import is navigable while the proxy is still running.

### 5.4 Filmstrip

The timeline track is a filmstrip of thumbnails, generated by **seeking**:
one `-ss <t> -i <src> -frames:v 1` per thumbnail, run through a small
concurrency pool. Seeking skips the frames in between, so cost scales with
thumbnail count, **not clip duration** — a 40-minute clip costs the same as a
2-minute one.

Generate from the proxy when one exists, otherwise from the original. Failure
is non-fatal: fall back to a plain track and let the user keep editing.

### 5.3 The proxy is preview-only

**The final render always reads the original file.** The proxy is never an
input to the output. Any code path that renders from a proxy is a bug.

---

## 6. Crop coordinate mapping — read this before touching crop code

This is the highest-risk area of the app. Most bugs will originate here.

**All crop coordinates are in display space. There is no source-space
conversion and no rotation math anywhere in this codebase.**

Display space means the frame as the user sees it, with rotation already
applied. This works because both ends of the pipeline agree on it:

- Chromium applies the display-matrix rotation when rendering `<video>`.
- FFmpeg auto-rotates by default, inserting the rotation filter *ahead* of
  user filters, so `crop` also operates on the rotated frame.

So a rectangle drawn on the player maps to the same pixels FFmpeg will cut,
with only a scale factor between them.

**Display dimensions:** from ffprobe, if rotation is ±90°, the display
dimensions are the coded `width`/`height` **swapped**. A portrait iPhone clip
commonly reports 1920×1080 coded with a 90° rotation, and must be treated as
1080×1920. Compute this once at probe time, store it on `MediaInfo`, and use
it everywhere. Never read raw `width`/`height` outside the probe function.

Rules:

- The `<video>` element is letterboxed inside its container. Compute the actual
  rendered video rect (`getBoundingClientRect` plus the intrinsic aspect ratio)
  and clamp the crop to it. Do **not** assume the video fills its container.
- Scale factor is `sourceDisplayWidth / renderedWidth`. When a tier 3 proxy is
  in use, that already accounts for the 720p downscale, since the proxy is a
  scaled version of the display-oriented frame.
- Account for `devicePixelRatio` when reading pointer coordinates.
- **Round `w`, `h`, `x`, `y` down to even integers.** Odd dimensions fail
  outright under `yuv420p` chroma subsampling.
- Enforce a minimum crop size (e.g. 32×32) in the UI.

**Required verification test.** This whole approach rests on FFmpeg applying
auto-rotation before user filters. Before building anything else, take a real
portrait phone clip, crop a visually distinctive corner, render, and confirm
the output contains that corner. If it doesn't, stop and re-derive the mapping
— do not paper over it with a transpose filter.

### 6.1 Manual rotation is the one exception

Some phones write the wrong display matrix, so the app offers a manual
correction: none / 90 / 180 / 270, degrees **clockwise**.

This does not reintroduce rotation math, and it does not weaken the rule above.
It is applied to **both ends of the pipeline**, never as a correction on one
side only:

| | |
| --- | --- |
| Preview | a CSS `transform: rotate()` on the `<video>` element |
| Filmstrip | the same rotation baked into the thumbnail filter chain |
| Render | `transpose=1` / `hflip,vflip` / `transpose=2`, placed **before** `crop` |

Because the rotation runs ahead of `crop` in the render, and ahead of the user's
eyes in the preview, display space simply *becomes* the rotated frame. Crop
coordinates keep their meaning and no inverse transform exists anywhere.

Directions are verified empirically, not assumed: a marker in the top-left of a
real frame lands top-right under `transpose=1`, which is what CSS `rotate(90deg)`
also does.

Rules:

- `viewSize()` is the single place that knows the axes swap on 90/270. Never
  read `displayWidth`/`displayHeight` directly for layout once rotation exists —
  use the view size.
- Changing rotation **resets the crop** to the full frame. Carrying a rectangle
  into a differently shaped space is guesswork; resetting is predictable.
- The filmstrip cache key includes the rotation, or stale thumbnails come back.
- This is still not a *transpose to fix auto-rotation*. If a clip looks wrong
  before the user touches this control, the bug is elsewhere — do not paper
  over it here.

Aspect-ratio lock is applied during the drag interaction in screen space, then
converted. Do not attempt to enforce the ratio after conversion — rounding to
even numbers will drift it slightly, and that's acceptable.

---

## 7. Output render spec

Crop is a filter, so this is always a full re-encode. There is no
`-c copy` fast path when a crop is active. The upside is that the trim is
frame-accurate for free.

```
ffmpeg -ss <startSeconds> -i <ORIGINAL_INPUT> -t <durationSeconds> \
  -vf "crop=<w>:<h>:<x>:<y>" \
  -c:v libx264 -preset slow -crf 17 \
  -pix_fmt yuv420p \
  -c:a aac -b:a 256k \
  -movflags +faststart \
  -progress pipe:1 -nostats \
  <outputPath>
```

Defaults and why:

- **`-crf 17`** — visually transparent for most content. `-crf 18` is the
  usual "high quality" figure; 17 buys margin for a second-generation encode,
  since the source has already been compressed once.
- **`-preset slow`** — better quality per bitrate. This app processes one short
  clip at a time, so encode speed is not the binding constraint.
- **Do not default to NVENC/QSV.** Hardware encoders are considerably faster
  but produce worse quality at a given size than x264 at `preset slow`. If a
  speed toggle is added later, make it explicit and off by default.
- **Audio is re-encoded, not copied.** Copying audio across an arbitrary trim
  point causes small A/V sync offsets, because audio frames don't align to the
  cut. 256k AAC is transparent enough that this is the right trade.
- **`-t` not `-to`.** With `-ss` placed before `-i`, `-to` semantics have
  changed across FFmpeg versions. Duration is unambiguous.
- If the source has no audio stream, omit the audio flags entirely rather
  than passing `-an` conditionally in a way that breaks the filter chain.
  When the user ticks **remove audio**, pass `-an` and drop the audio codec
  flags.

### 7.1 HDR sources must be tone-mapped

Recent Android phones record **10-bit HLG HDR** (`color_transfer=arib-std-b67`,
BT.2020 primaries). Samsung is the expected source here, so this is the normal
case, not an edge case.

Encoding such a source with the spec above and nothing else produces an 8-bit
`yuv420p` H.264 file **still tagged BT.2020/HLG** — a broken combination. Most
SDR players and every social platform ignore HDR tags on H.264 and render the
HLG curve as plain gamma, giving a flat, dull, desaturated result. Players that
honour the tags render it differently again, so the file looks inconsistent
across devices. That contradicts section 2's "visually indistinguishable from
the source".

When — and only when — ffprobe reports `color_transfer` of `arib-std-b67` or
`smpte2084`, prepend a tone-map to the filter chain and let the output be
tagged BT.709:

```
crop=<w>:<h>:<x>:<y>,
zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,
tonemap=tonemap=hable:desat=0,
zscale=t=bt709:m=bt709:r=tv,format=yuv420p
```

Crop goes **first** — tone-mapping fewer pixels is cheaper and the result is
identical. SDR sources must skip the chain entirely; running it on BT.709
input degrades the image for no reason.

There is no preview-side equivalent to configure: tier 1 sources play through
Chromium, which does its own HDR-to-display mapping. The filmstrip is
tone-mapped so the strip matches the player.

Output defaults to the source directory with a `_trimmed` suffix, and never
silently overwrites an existing file.

### 7.2 Quality presets

The fixed default has been proven correct against real footage, so a quality
control is now warranted — the anti-pattern in section 11 was about shipping the
dropdown *before* that proof, not about the control itself.

| | CRF | Preset | Audio |
| --- | --- | --- | --- |
| **High** (default) | 17 | slow | 256k |
| Medium | 20 | medium | 192k |
| Low | 23 | fast | 128k |

High is unchanged from the verified spec above and stays the default. An unknown
or missing quality key falls back to High — never to something lossier.

---

## 8. Progress reporting

Parse `-progress pipe:1` output from **stdout** — it emits `key=value` lines
including `out_time_us` and `progress`. Do not scrape the human-readable
stderr status line; its format is unstable across versions.

Percent = `out_time_us / (trimDurationSeconds * 1_000_000)`, clamped to 0–100.

---

## 9. Packaging — known traps

**No installer, and no self-extracting exe.** The app ships as a **zip of the
app folder** and nothing else. The user unzips it anywhere and double-clicks.
Nothing writes to the registry, nothing needs admin, nothing is left behind. Do
not add an NSIS/MSI/portable target back without being asked.

The Windows icon is `build/icon.ico`, generated from `build/icon.png` by
`scripts/make-icon.mjs` as a genuine multi-resolution icon. Letting
electron-builder convert the PNG itself yields a single size, which Windows
then rescales badly in most of the places it appears.

Three separate things need it, and setting only the first leaves the others
looking wrong:

1. `win.icon` — embedded in the exe, used by Explorer.
2. `BrowserWindow({ icon })` — the title bar, and the taskbar in a dev run
   (which launches `electron.exe` and would otherwise show the stock logo). The
   `.ico` is shipped loose via `extraResources` so it can be resolved at
   runtime, the same way the binaries are.
3. `app.setAppUserModelId(appId)` — Windows keys taskbar grouping and its icon
   off this; without it the app can inherit the generic Electron identity.

If the icon looks stale after a rebuild, suspect the Windows icon cache before
suspecting the build — extract the icon from the exe and check it directly.

**The FFmpeg binary path breaks in packaged builds.** Inside a packaged app
the binaries land in `app.asar`, and files inside an asar archive cannot be
executed. This works in dev and fails only after packaging, so it is easy
to miss.

Required:
1. Add the binaries to `asarUnpack` in `electron-builder` config.
2. Resolve the path with an explicit rewrite:

```ts
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  : path.join(__dirname, '../../resources/bin/ffmpeg.exe');
```

3. Never call `ffmpeg` unqualified — always the resolved absolute path.
4. Assert the binaries exist at startup and fail loudly with a clear message.

Also: quote nothing manually. Pass arguments to `spawn` as an **array**.
Building a shell command string will break on paths containing spaces, and
Windows user paths frequently do.

---

## 10. Licensing note

A static FFmpeg build with x264 is GPL-licensed — GPL **v3** for the build in
use, because it is configured `--enable-gpl --enable-version3`.

The project's own source is **MIT**. That combination holds because the app
**spawns `ffmpeg.exe` as a separate process** and never links FFmpeg's
libraries. Do not change that: linking libavcodec directly would pull this
codebase into the GPL.

The binaries are not in git and **cannot** be — ~140 MB each against GitHub's
100 MB per-file hard limit. `npm run fetch-ffmpeg` downloads and validates
them, so a source clone is one command away from working. The released zip
contains them, so end users are unaffected.

Obligations attach to the **distributed zip**, not to this repository. They are
written out in `THIRD-PARTY-NOTICES.md`, which ships inside the zip alongside
`LICENSE`. Flag licensing questions rather than silently working around them.

---

## 11. Anti-patterns — do not do these

- Using `ffmpeg.wasm` instead of the native binary. It is roughly an order of
  magnitude slower, has no hardware acceleration, and is memory-capped.
- Resolving FFmpeg from system `PATH`.
- Hardcoding which codecs Chromium can play. Probe at runtime (§5.1.1).
- Encoding an HDR source without tone-mapping it (§7.1), or tone-mapping an
  SDR source that didn't need it.
- Scaling the output. The crop rectangle *is* the output resolution, 1:1.
- Doing FFmpeg work in the renderer process.
- Rendering the final output from the proxy file.
- Assuming display dimensions equal coded dimensions.
- Transcoding when a remux (`-c copy`) would have worked.
- Reading raw ffprobe `width`/`height` outside the probe function.
- Adding rotation or transpose filters to compensate for auto-rotation. The
  only legitimate rotation is the user's explicit manual correction (§6.1),
  applied to preview and render alike.
- Odd-numbered crop dimensions.
- Building shell command strings instead of argument arrays.
- Generic error messages that discard FFmpeg stderr.
- Changing the High preset, or defaulting to anything below it. The three
  presets in §7.2 exist because the fixed default was proven correct first;
  High remains the default and the reference.
