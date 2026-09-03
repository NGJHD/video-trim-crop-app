# UI Proposal — Video Trim & Crop

Status: **approved and implemented.** Revision 3. Landscape-first and
responsive, no crop coordinates, no file bar, no replace button, crop rail on
the left, output bar at the bottom, play/pause with loop stacked beside the
timeline, filmstrip in. Verification results in §13; the two design questions
that came out of the real samples are resolved in §14 (HDR) and §15 (tier
detection).

---

## 0. Design principles

1. **One window, no modals, no wizard.** Drop, crop, trim, render — all on a
   single screen. A modal would hide the video, which is the one thing the user
   needs to see at all times.
2. **The video is the biggest thing on screen.** Everything else is a thin rail
   around it. Sources are landscape *or* portrait phone video, so the stage has
   to handle 16:9 and 9:16 equally well and grow to fill a maximised window.
3. **Show only the numbers that define the output.** Trim in/out, output
   resolution, output duration, output path. Crop x/y/w/h are working state,
   not results — the rectangle on screen already says where it is.
4. **An empty window shows nothing to operate.** With no file loaded there is
   no output bar, no disabled Process button and no orphaned checkbox — just the
   drop target. Controls appear when there is something to control.
5. **Long operations are determinate.** Import (tier 2/3), filmstrip and render
   all show a real percentage and a Cancel button. Never a bare spinner (§5.2).

---

## 1. Window & layout

- Default **1360 × 860**, minimum **900 × 620**. Fully resizable and designed to
  be maximised — see §9 for how each region behaves as the window grows.
- Dark UI. Video against a light background misleads the eye about exposure and
  makes the letterbox area ambiguous.
- All file metadata lives in the **window title**, so no bar is spent on it:

```
Video Trim & Crop — IMG_4821.MOV · 1920 × 1080 · 30 fps · 00:24.70 · h264
```

  With nothing loaded, the title is just `Video Trim & Crop`.

- Four regions:

```
  ┌──────────────────────────────────────────────────┐
  │ title bar  (app name + file metadata)            │
  ├──────────┬───────────────────────────────────────┤
  │  CROP    │                                       │
  │  rail    │        PREVIEW STAGE                  │
  │          │        (video + crop overlay)         │
  ├──────────┴───────────────────────────────────────┤
  │ ▶     filmstrip timeline + trim handles          │
  │ loop                                             │
  ├──────────────────────────────────────────────────┤
  │ OUTPUT BAR  — path · size · audio · Process      │
  └──────────────────────────────────────────────────┘
```

The crop rail is a fixed 200 px. The timeline block is a fixed ~92 px tall. The
output bar is a fixed ~52 px. **Everything left over goes to the stage.**

---

## 2. Screen states

### 2.1 Empty — awaiting a file

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Video Trim & Crop                                                                      ─   □   ✕  │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                    │
│                                                                                                    │
│                      ╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮                      │
│                      ╎                                                      ╎                      │
│                      ╎                 ▣  Drop a video here                 ╎                      │
│                      ╎          MP4 · MOV · MKV · AVI · WebM · TS           ╎                      │
│                      ╎                                                      ╎                      │
│                      ╎            or  [ Choose file… ]  (Ctrl+O)            ╎                      │
│                      ╎                                                      ╎                      │
│                      ╰╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╯                      │
│                                                                                                    │
│                                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The **whole window** is the drop target; the dashed box is only the
  affordance. Dragging anything over the window tints the window border.
- A dropped non-video, or a file ffprobe can't parse, shows a red line under the
  box with the ffprobe stderr tail, and leaves any currently loaded file alone.

### 2.2 Loading a new file — replacing by drop

There is **no Replace button.** Dropping a second video onto the window at any
time discards the current one and loads the new one. Specifically:

- Any running proxy or filmstrip job is cancelled; the old proxy, filmstrip
  cache and any partial temp files are deleted immediately.
- Crop rectangle and trim points reset to defaults.
- **Exception:** if a render is actually in progress, the drop is refused and
  the output bar says *"Rendering — cancel first to load another file."* Silently
  killing a render the user is waiting on is worse than a moment of friction.
- `Ctrl+O` still opens a file dialog for people who'd rather not drag.

### 2.3 Importing — the rare tier 2 / tier 3 case

**Almost every import skips this.** The tier is decided by actually trying to
play the file (§15), and on any machine with a 2016-or-later GPU the expected
HEVC phone footage plays natively — so import is instant regardless of length.
This state only appears for an odd container, an exotic codec, or a machine
with no hardware HEVC decoder.

When it does appear, the output bar is replaced in place by a determinate bar;
the stage shows the first frame as a poster if we have one:

```
│  Preparing preview — transcoding HEVC   ██████████░░░░░░░░░░░░  31 %              [ Cancel ]       │
```

Copy varies by tier: *"Rewriting container"* (tier 2, usually gone in under a
second) vs *"Transcoding preview"* (tier 3). If the 4-minute guard in §5.3 of
CLAUDE.md trips, this is preceded by an inline confirm strip — *"This 22-minute
clip needs about 5 minutes to prepare. [ Start ] [ Choose another file ]"* —
not a dialog.

The filmstrip is generated **first**, before the proxy, because it is
duration-independent (§5.4). So even a slow tier 3 import gives you a navigable
timeline within seconds; only playback waits.

### 2.4 Main editor — the working state (landscape source shown)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Video Trim & Crop — IMG_4821.MOV · 1920 × 1080 · 30 fps · 00:24.70 · h264              ─   □   ✕  │
├────────────────────┬───────────────────────────────────────────────────────────────────────────────┤
│  CROP              │                                                                               │
│                    │                ┌────────────────────────────────────────────┐                 │
│  ● Free            │                │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                 │
│  ○ 1:1             │                │░░░░■━━━━━━━━━━━━━━■━━━━━━━━━━━━━━━■░░░░░░░░│                 │
│  ○ 3:2             │                │░░░░┃         ·         ·          ┃░░░░░░░░│                 │
│  ○ 16:9            │                │░░░░┃╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌┃░░░░░░░░│                 │
│  ○ Original        │                │░░░░■         ·         ·          ■░░░░░░░░│                 │
│                    │                │░░░░┃╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌┃░░░░░░░░│                 │
│  [ Reset crop ]    │                │░░░░┃         ·         ·          ┃░░░░░░░░│                 │
│                    │                │░░░░■━━━━━━━━━━━━━━■━━━━━━━━━━━━━━━■░░░░░░░░│                 │
│                    │                │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                 │
│                    │                │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                 │
│                    │                └────────────────────────────────────────────┘                 │
│                    │                                                                               │
├────────────────────┴───────────────────────────────────────────────────────────────────────────────┤
│           ┌─────────────────────────────────────────────────────────────────────────────────────┐  │
│  [ ▶ ]    │░░░░░░░░░░░░░░┃▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▮▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┃░░░░░░░░░░░░░░░░░░│  │
│  [x] loop │░░░░░░░░░░░░░░┃▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▮▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┃░░░░░░░░░░░░░░░░░░│  │
│           └─────────────────────────────────────────────────────────────────────────────────────┘  │
│                      00:04.20                                            00:11.60                  │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  …\IMG_4821_trimmed.mp4  [ Change… ]   1280 × 720 · 7.40 s   [ ] remove audio    [  Process  ⏎  ]  │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Stage legend: `░` = area outside the crop, dimmed to ~55 % black. `■` = drag
handle (4 corners + 4 edge midpoints). `╌` / `·` = rule-of-thirds guides, drawn
only while dragging. No coordinate readout anywhere — the rectangle *is* the
readout.

Timeline legend: `▓` = filmstrip thumbnails inside the trim selection, `░` =
thumbnails outside it (desaturated and dimmed), `┃` = trim handles with their
timecodes underneath, `▮` = playhead.

A **portrait** source uses the identical layout — the video is simply tall and
narrow in the same stage, with wide letterbox areas either side. The crop rail
and the timeline don't change.

### 2.5 Processing

The output bar is replaced in place. The video, crop and timeline stay on
screen and stay readable; interaction is locked.

```
│  Encoding  ██████████████████████████░░░░░░░░░░░░░░░░░░  57 %   ~13 s left        [ Cancel ]       │
```

Percent comes from `out_time_us / (trimDuration × 1e6)` per §8 of CLAUDE.md.
The estimate is a rolling average of the last few progress ticks, suppressed for
the first 3 seconds so it doesn't flash a wild number.

### 2.6 Done

```
│  ✓  Saved IMG_4821_trimmed.mp4  ·  1280 × 720 · 7.40 s        [ Show in folder ]   [ ✕ ]           │
```

Persists until dismissed or until the next render. The editor stays live so the
user can adjust and render again — a second render auto-increments the filename
rather than overwriting (§6).

### 2.7 Error

```
│  ⚠  Render failed — ffmpeg exited with code 1                                    [ Copy details ]  │
│     ▾ ffmpeg output (last 20 lines)                                                                │
│     ┌────────────────────────────────────────────────────────────────────────────────────────┐     │
│     │ [libx264 @ 000001f4] height not divisible by 2 (1281x720)                              │     │
│     │ Conversion failed!                                                                     │     │
│     └────────────────────────────────────────────────────────────────────────────────────────┘     │
```

The error panel grows upward from the output bar, pushing the timeline up rather
than covering the video. Collapsed by default, expandable, monospace,
selectable, with a copy button — per §4.2 the stderr tail is the whole
diagnostic value and must never be swallowed. Same treatment for probe, proxy
and filmstrip failures.

---

## 3. The left rail

Three sections, top to bottom: **Crop** (aspect mode + reset), **Rotate**, and
**Trim** (reset), with an **About** link pinned to the bottom. Everything that
changes the shape or extent of the output and isn't a direct manipulation lives
here.

| Mode | Behaviour |
| --- | --- |
| **Free** | No constraint |
| **1:1** | Square |
| **3:2** | Landscape 3:2 |
| **16:9** | Landscape 16:9 |
| **Original** | Locked to the source **display** aspect ratio — 16:9 for a landscape clip, 9:16 for a portrait one |

`[ Reset crop ]` returns the rectangle to the full frame.

### 3.1 Rotate

Below the crop section, a second radio group: **None · 90° · 180° · 270°**,
clockwise. It exists because some phones write the wrong display matrix, and
without it those clips can only be fixed in another tool.

- The video rotates **instantly**, via a CSS transform — no re-encode, no wait.
- The filmstrip regenerates with the rotation baked in, so the strip and the
  player never disagree. It takes a few seconds and the old strip stays visible
  meanwhile.
- The output size readout swaps immediately (1080 × 1920 becomes 1920 × 1080).
- **The crop resets to the full frame**, and the rail says so in small text.
  Carrying a rectangle into a differently shaped frame would be guesswork.
- `Original` then follows the *rotated* frame, not the file's own orientation.

The render applies the matching transpose filter ahead of the crop, so what is
framed on screen is what lands on disk. See §6.1 of CLAUDE.md for why this
doesn't break the display-space model.

### 3.2 Trim

`[ Reset trim ]` selects the whole clip again. It sits in the rail rather than
the timeline because it is the same kind of thing as `Reset crop` — an escape
hatch from a direct manipulation, not part of the manipulation itself.

**Both reset buttons disable themselves when there is nothing to undo** —
`Reset crop` when the rectangle is already the whole frame, `Reset trim` when
the selection already spans the full length. A reset that can't change anything
shouldn't look like it could.

### 3.3 About

Pinned to the bottom of the rail (`mt-auto`), below Trim: an **About** button,
carrying the same border and hover as `Reset crop` / `Reset trim`. It is the
only thing in the rail that isn't about this clip, so it sits apart from the
sections rather than becoming a fourth one.

It was a plain text link first, and read as a *label* — nobody tried clicking
it. Anything clickable in this rail wears the same border the resets do.

The ⓘ marks it as a different kind of thing from the two resets. It is an
**inline SVG, not the character U+24D8**: that glyph isn't in the UI font stack,
so Windows falls back to Segoe UI Symbol, whose metrics leave the circle sitting
1.5 px low — `items-center` centres the inline *boxes*, not the ink. Drawn, it
lands dead centre on every machine. Don't swap it back for a character.

The rail doesn't exist until a video is loaded, so **the empty state carries the
same button** in the bottom-left corner. One entry point looked fine right up
until the app had nothing open.

It opens a **modal**: app name, author, version, a link to the repo, and a
**Check for updates** button.

- The dialog is genuinely modal — the editor's keyboard map is suppressed while
  it is open, and `Esc` closes the dialog rather than cancelling a job.
- Checking is one line of status text: *"Version 1.0.0 is the latest."*, or
  *"Version 1.1.0 is available (248.8 MB)."* with the button turning amber and
  becoming **Update to 1.1.0**.
- Installing shows a determinate bar with **bytes, not just a percentage** —
  "48.2 MB of 248.8 MB" tells you it isn't stuck. Cancel is offered during the
  download and disappears once unpacking starts, because by then there is
  nothing left to abort.
- Every failure is a sentence worth reading — *"GitHub is rate limiting this
  connection. Try again in an hour."* — with an *Open the releases page instead*
  fallback underneath.
- Nothing checks on launch and nothing nags. The mechanism, and what a release
  has to look like for it to work, are in CLAUDE.md §9.2–9.3.

| Gesture | Result |
| --- | --- |
| Drag on empty stage area | Draw a new rectangle from scratch |
| Drag inside the rectangle | Move it (clamped to the rendered video rect) |
| Drag a corner/edge handle | Resize from that anchor |
| `Alt` + drag handle | Resize about the centre |
| Double-click inside | Reset to full frame |
| Arrow keys | Nudge 1 display px · `Shift` = 10 px |

Rules, straight from §6 of CLAUDE.md:

- The rectangle is clamped to the **rendered video rect** (`getBoundingClientRect`
  plus the intrinsic aspect ratio), never to the container. Letterbox bars are
  not croppable — and with a landscape clip in a maximised window there will be
  plenty of letterbox to accidentally grab.
- Aspect lock is enforced **during the drag, in screen space**. After conversion
  to source space and even-rounding, the ratio may drift a fraction of a
  percent. That is accepted and not corrected afterwards.
- Crop values are even-rounded before they reach ffmpeg; the output resolution
  shown in the output bar is the post-rounding number, so it always matches what
  lands on disk.
- Minimum 32 × 32 source px; handles stop rather than allowing a smaller box.
- Switching aspect mode keeps the rectangle's centre and fits the largest
  rectangle of that ratio inside the current bounds.

Everything above is display space. No rotation math anywhere in the UI.

---

## 4. Timeline, filmstrip & transport

- **Play/pause and stop**, side by side in a narrow control column to the left
  of the track, with a **loop checkbox stacked directly underneath** — the same
  control style as "remove audio" in the output bar, so the two read as the same
  kind of thing.
- **Stop** pauses and rewinds to the trim start, which is the position you want
  before reviewing a cut again. No skip/step buttons —
  those live on the keyboard (§5). Nothing sits to the right of the track, so
  the filmstrip runs all the way to the right edge.
- No running `current / total` readout. The only timecodes on screen are the two
  trim points, sitting under their handles, because those are what determine the
  output.
- The track *is* the filmstrip: thumbnails rendered edge to edge, ~2 rows tall
  (≈64 px). Frames inside the selection are full brightness; frames outside are
  dimmed and desaturated, so the kept range reads at a glance.
**The track answers three gestures:**

| Gesture | Result |
| --- | --- |
| Click | Seek. The trim selection is untouched. |
| Drag | Define a new selection: press point to release point |
| Right-click | Menu: set trim start / end at that frame |

Click and drag start identically, so they are told apart by distance: a press
becomes a drag only once the pointer has travelled **8 px**. Below that it stays
a click and only moves the playhead, which keeps a slightly shaky click from
wiping out a selection. A drag is direction-agnostic — right-to-left selects the
same span as left-to-right — and ends with the playhead on the new trim start,
ready to review what was just selected.

**The playhead has its own handle:** a small white square sitting just above the
strip, with the line running from it down through the track so it reads as the
head of that line rather than a floating chip. The gap stays between the *box*
and the filmstrip; the line crosses it.

Box and line are **one positioned element** spanning both the handle strip and
the track, so they share a single `left` and are the same 1px column by
construction — there is nothing to keep in sync. They were two elements in
different parents at first, and drifted: the track carried a 1px `border`, which
shrinks the padding box that `left: %` resolves against, while `timeAt()` reads
the border box. The playhead sat up to 1px off at the ends and *exactly on at
the midpoint*, which is a good way to miss a bug. The track now draws its
hairline with an inset box-shadow, which costs no layout, and the trim handles
line up with the click positions that set them for the same reason.

- Dragging the handle **scrubs and only scrubs** — it never edits the trim. That
  is why scrubbing didn't have to fight drag-to-select for the track: each
  gesture got its own target.
- Right-clicking it opens the same trim menu, but anchored to the **playhead
  position** rather than the cursor, so *Set trim start here* means "at the frame
  I'm looking at".
- **Right-click the filmstrip** for *Set trim start here* / *Set trim end here*,
  acting on the frame under the cursor. Faster than dragging a handle the length
  of a long clip. The menu shows the timecode it will use, and the option that
  would invert the selection is disabled.
- Two trim handles, which cannot cross; minimum selection 0.1 s. Dragging a
  handle scrubs the video to that frame so the cut point is visible live.
- **Playback is always confined to the trim range.** The selection *is* the clip
  you're working on, so playing past it would show footage that won't be in the
  output. Reaching the end pauses there.
- **Loop** (on by default) only changes what happens at that boundary: wrap back
  to the start instead of stopping. It is not what makes the boundary apply —
  treating it that way was a bug, where unchecking loop played the whole file.
- Pressing play from outside the selection snaps to the trim start first.

**Rebuild feedback.** Whenever the strip is regenerating — on import, on a
material resize, and notably after a **rotation** — a translucent scrim with
*"building filmstrip…"* covers the track. It is deliberately see-through: the
previous strip stays readable underneath and the timeline keeps working. A
rotation rebuild takes several seconds on a long clip, and without this there is
no sign anything is happening. A cache hit finishes in milliseconds and the
scrim never meaningfully appears, which is correct — nothing was rebuilt.

**Filmstrip generation.** A single ffmpeg pass after the source is playable,
reading the proxy when there is one and the original otherwise (preview only —
never an input to the render). It writes N JPEG tiles into the temp directory,
where N is derived from the track's pixel width, and emits progress on the same
`job:progress` channel. It is cancellable, it is cleaned up with the proxy, and
if it fails the timeline silently falls back to a plain solid track — a missing
filmstrip must never block trimming.

---

## 5. Keyboard map

The removed transport buttons are all still available as keys.

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step 1 frame · `Shift` = 1 s |
| `Home` / `End` | Jump to in / out point |
| `I` / `O` | Set in / out at the playhead |
| `L` | Toggle loop selection |
| `R` | Reset crop to full frame |
| `Ctrl+O` | Open file |
| `Ctrl+Enter` | Process |
| `Esc` | Cancel running job |

---

## 6. Output bar

Left to right: path · Change · output resolution and duration · remove-audio ·
**quality** · Process. This bar is also the progress bar, the success banner and
the error panel (§2.5–2.7) — one slot, five faces.

**With no file loaded the bar is not rendered at all** (§0.4). It appears on
import, and an error still surfaces without one.

**The output is never scaled.** The crop rectangle's size *is* the output
resolution, 1:1, with no upscaling to fill some target frame and no letterboxing.
Crop a 200 × 200 square out of a 4K clip and the file on disk is 200 × 200.
Crop nothing and the output matches the source resolution exactly. The
`1280 × 720` in the bar is therefore a readout, never a setting — there is no
resolution to choose. *(Verified — see §13.)*

- Default path: source directory, `<name>_trimmed.mp4`, per §7 of CLAUDE.md. The
  path is middle-ellipsised and shows the full path on hover.
- If the default file already exists, the field pre-fills `_trimmed_1`,
  `_trimmed_2`, … and says so. Overwriting only happens if the user picks that
  exact path themselves in the save dialog, and even then it re-confirms.
- Container is always `.mp4` regardless of input, since the render spec is
  H.264 + AAC + `faststart`.
- `1280 × 720 · 7.40 s` is the **output** size and duration, updating live as
  the crop and trim change. It is not a crop coordinate readout — but say the
  word and it goes too.
- **`[ ] remove audio`** — unchecked by default. Checked, the render drops the
  audio flags and adds `-an`. If the source has no audio stream the checkbox is
  disabled and labelled *"no audio track"*, and the render omits audio flags
  entirely either way (§7 of CLAUDE.md).
- **Quality** — `High` (default) / `Medium` / `Low`, sitting between the audio
  checkbox and Process. High is the verified `crf 17 / preset slow` spec;
  the others trade quality for size (§7.2 of CLAUDE.md). The default is never
  anything but High.
- `Process` is disabled while a job runs, while the trim selection is empty, or
  before a file is loaded.

---

## 7. Workflow — end to end

```
  drop / Ctrl+O                       (a second drop replaces — §2.2)
        │
        ▼
  main: media:probe ──► MediaInfo { codec, coded w/h, rotation,
        │                           DISPLAY w/h, duration, fps, hasAudio }
        │                (display dims computed once, here, and nowhere else)
        ▼
  tier decision  ── tier 1 ──► <video src=original>
        │
        ├───────── tier 2 ──► media:proxy  (-c copy remux)      ─┐
        └───────── tier 3 ──► media:proxy  (720p x264 proxy)    ─┤
                                     │ job:progress  →  §2.3 bar │
                                     ▼                           │
                              <video src=proxy>  ◄───────────────┘
        │
        ├──► media:filmstrip  (proxy or original, N thumbs) ──► timeline track
        │        failure here is non-fatal — plain track, editing continues
        ▼
  EDIT   crop rect (display space)  +  in/out points
        │                     · playback, loop, scrub
        │                     · nothing touches the source
        ▼
  Process ──► media:process { srcPath: ORIGINAL, start, duration,
        │                     crop{x,y,w,h}, outPath, hasAudio, removeAudio }
        │       ▲ never the proxy path — §5.3 of CLAUDE.md
        │
        │  job:progress (out_time_us from -progress pipe:1) → §2.5
        ├──► job:done  { outputPath }            → §2.6
        └──► job:error { message, ffmpegTail }   → §2.7

  cancel: Esc / [ Cancel ] ──► media:cancel(jobId) ──► kill child,
                                delete the partial output file
```

Cleanup: proxies and filmstrips are deleted when a new file is loaded, on window
close and on `will-quit`; the whole `temp/video-trim-crop/` directory is swept at
startup to catch anything a crash left behind. Any in-flight ffmpeg child is
killed on window close and app quit (§4.1) — no orphans.

---

## 8. Renderer structure

```
App
├── (window title)     app name + media summary, set via IPC on probe
├── CropRail           aspect mode list, reset          [left, fixed 200px]
├── Stage
│   ├── VideoSurface   <video>, computes the rendered video rect
│   └── CropOverlay    rectangle, 8 handles, dim mask, thirds guides
├── TimelineBar
│   ├── PlayButton     play / pause
│   ├── Timeline       filmstrip track, playhead, in/out handles + timecodes
│   └── LoopToggle
├── OutputBar          idle | importing | rendering | done | error
└── AboutDialog        modal: identity, version, repo link, update button
                       (InfoIcon is shared by CropRail and DropZone)
```

One store (`useEditorStore`): `media`, `playback`, `crop`, `trim`, `output`,
`job`. Crop and trim are plain numbers in source display space; nothing in the
store knows about screen coordinates — that conversion lives only in
`CropOverlay`.

---

## 9. Responsive behaviour

Written for maximising on a 1080p or 4K Windows display.

| Region | On resize |
| --- | --- |
| Crop rail | Fixed 200 px, never scales |
| Stage | Absorbs all extra width **and** height; video re-letterboxes into it. Padded on all sides so the crop handles, which straddle the frame edge, are never clipped by the window border |
| Crop rectangle | Held in source display space, so it re-projects onto the new rendered rect exactly — resizing never moves the crop by a pixel |
| Timeline | Full width; height fixed at ~92 px |
| Filmstrip | Thumbnail count recomputed on width change, debounced 300 ms, and only re-rendered if width changed > 15 % — otherwise the existing tiles are just stretched |
| Output bar | Full width, fixed height; path field takes the slack |

Below ~1100 px wide the output bar's resolution/duration text drops to a
tooltip so the path and Process button never collide. Below the 900 × 620
minimum, nothing — the window can't get there.

`devicePixelRatio` is accounted for when reading pointer coordinates, so crop
dragging is accurate on scaled Windows displays (125 % / 150 % are the common
cases and both must be tested).

---

## 10. Visual style

- Ground `#171717`, rails `#1f1f1f`, hairlines `#2f2f2f`, text `#e5e5e5`.
- One accent (amber `#f0a500`), used *only* for the crop rectangle, the trim
  selection and the Process button — the three things the user manipulates.
- Success green and error red appear only in the output bar.
- System UI type stack; **tabular numerals for the trim timecodes** so digits
  don't jitter while dragging.
- Standard Windows frame, no custom titlebar — the title carries the file
  metadata and custom frames tend to break snap/maximise.

---

## 11. Decisions locked in

| # | Decision |
| --- | --- |
| 1 | **Plain JavaScript** + JSDoc. The shared contract file is `src/shared/ipc.js`. |
| 2 | Copy `ffmpeg.exe` / `ffprobe.exe` from the local Gyan full GPL build into `resources/bin/`, gitignored. |
| 3 | Trim with no crop still **re-encodes**, just without `-vf`. Frame-accurate, one code path. |
| 4 | **Remove-audio checkbox** in the output bar, unchecked by default. |
| 5 | **Filmstrip thumbnails are in** for v1. |
| 6 | App name stays **Video Trim & Crop**. |
| 7 | Landscape-first, responsive, maximisable. No crop coordinates, no file bar, no replace button. |
| 8 | Play/pause and the loop toggle stack in a control column left of the timeline; the filmstrip runs to the right edge. |
| 9 | Output is never scaled — the crop rectangle is the output resolution, 1:1. |

---

## 12. Out of scope for v1

Batch / queue · multiple crop keyframes · rotation controls (auto-rotation
handles it, §6 of CLAUDE.md) · filters, colour, audio levels · export presets or
a quality dropdown (§11 anti-patterns) · undo history beyond crop/trim reset ·
zoomable timeline.

---

## 13. Verification against the real samples — **done, and it passes**

Run against real phone footage before writing any code, as CLAUDE.md
§6 requires.

### 13.1 What the samples actually are

| | `20260111_191723.mp4` | `20260111_192423.mp4` |
| --- | --- | --- |
| Coded | 1920 × 1080 | 1920 × 1080 |
| Display matrix | none | **rotation −90** |
| **Display dims** | **1920 × 1080** (landscape) | **1080 × 1920** (portrait) |
| Codec | HEVC Main 10, `yuv420p10le` | HEVC Main 10, `yuv420p10le` |
| Colour | BT.2020 / `arib-std-b67` (**HLG HDR**) | BT.2020 / `arib-std-b67` (**HLG HDR**) |
| Frame rate | 30 fps | 30 fps |
| Duration | 43.17 s | 118.70 s |
| Audio | AAC stereo 48 kHz | AAC stereo 48 kHz |
| Import tier | **3 — transcode** | **3 — transcode** |

Both are Samsung Android recordings. Two consequences worth naming:

- The portrait clip is exactly the case §6 warns about: coded 1920 × 1080 but
  **must be treated as 1080 × 1920**. The design's display-dims-at-probe-time
  rule is load-bearing, not theoretical.
- Both are HEVC, so **tier 3 is the normal path for your footage, not the
  exception.** The 118 s clip in particular means the import progress bar in
  §2.3 will be on screen for a real amount of time on most imports.

### 13.2 Rotation / crop mapping — PASS

Using the portrait clip:

1. A frame extracted straight from the source comes out **1080 × 1920** — FFmpeg
   auto-rotated it, matching what Chromium will show.
2. Cropping **all four corners** via `-vf crop=400:400:x:y` produced pixel-for-pixel
   the same result as cropping the already-rotated display frame at the same
   coordinates (PSNR 68–81 dB across the four; the residual is just colour-conversion
   rounding between the two paths).
3. End-to-end with the real §7 render spec — `-ss 10 -i src -t 1
   -vf crop=540:540:540:1380 -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p
   -c:a aac -b:a 256k -movflags +faststart` — produced a **540 × 540** H.264 file
   whose content is the correct bottom-right region, confirmed both by PSNR
   (40.4 dB vs. reference — second-generation encode difference, not a geometry
   mismatch) and by eye.
4. The output carries **no rotation side data**, which is right: the pixels are
   already upright.

**Conclusion: crop coordinates in display space map directly to `crop=w:h:x:y`,
with only a scale factor.** No transpose filter, no rotation math. The design in
§3 stands as written.

### 13.3 Output is never scaled — PASS

`-vf crop=200:200:100:100` through the full render spec produced a file that
ffprobe reports as exactly **200 × 200**. `crop` cuts; it does not resample.
Nothing in the pipeline scales the final render — the only `scale` in the whole
app is the 720p *proxy*, which never touches the output.

---

## 14. HDR — resolved: auto tone-map on output

Both Samsung samples are **HLG HDR** — 10-bit, BT.2020 primaries,
`arib-std-b67` transfer. Rendering them with the §7 spec as originally written
produced an 8-bit `yuv420p` H.264 file still tagged BT.2020/HLG, which most
players render flat and desaturated. I compared tone-mapped and untone-mapped
renders of the same frame; the difference is clearly visible.

**Decision: auto tone-map, and only when the source is actually HDR.** No
toggle, no UI — it is a correctness fix, not an option. `color_transfer` of
`arib-std-b67` or `smpte2084` triggers it; everything else skips the chain
entirely. Written up as §7.1 of CLAUDE.md.

Crop runs **before** the tone-map in the filter chain, since tone-mapping fewer
pixels is cheaper and the result is identical.

**No preview-side equivalent is needed.** Tier 1 sources play through Chromium,
which does its own HDR-to-display mapping, so the preview looks right without
us doing anything. The filmstrip *is* tone-mapped, so the strip matches the
player rather than sitting next to it looking washed out — it costs a few
milliseconds per thumbnail and nothing at import time.

---

## 15. Tier detection — resolved: probe at runtime, never hardcode

The original design took CLAUDE.md §5.1's static table at face value: tier 1
meant MP4/MOV/WebM holding `h264`/`vp8`/`vp9`/`av1`, and HEVC was tier 3. A
direct test proved that wrong — **both Samsung HEVC clips play natively**, at
the correct 1080 × 1920 display size.

The table isn't just out of date, it's the wrong shape. Chromium decodes HEVC
through the GPU and ships **no software fallback**, so playability depends on
the machine (roughly Intel HD4400+, NVIDIA GT635+, AMD RX460+), not on the
codec alone. One binary, different answers on different hardware. Any static
list is wrong somewhere — which matters directly for the "copy the folder and
run it" requirement.

**So the tier is decided by trying.** After ffprobe, the original file is handed
to a detached `<video>`; if one frame decodes within the timeout it's tier 1,
otherwise we fall back to remux or transcode using the ffprobe codec as a hint.
Verdicts are cached per `codec/profile/pix_fmt` for the session. Full rationale
in §5.1.1 of CLAUDE.md.

Consequences for this design:

- **The long-clip problem is gone.** Samsung footage imports instantly at any
  duration. The 15-minute proxy wait, the duration threshold and the
  segment-on-demand escape hatch all collapse into a rare fallback path.
- **No proxy means the filmstrip reads the original.** Fine — FFmpeg decodes
  HEVC directly.
- The app degrades gracefully on a machine without HEVC hardware instead of
  breaking: the probe fails, and it transcodes a proxy like any other tier 3.

---

## 16. Verified environment

Measured on the development machine (Ryzen 9 3900X, RTX 3080, Windows 11):

| | |
| --- | --- |
| Native HEVC Main 10 HLG playback | **yes** — both samples, correct display dims |
| Bundled FFmpeg | 9.0 GPL full build, with `zscale` / `tonemap` / `libplacebo` |
| NVENC | **unavailable** — this build needs NVENC API 13.1 (driver 610+), installed driver provides 13.0. Not depended on anywhere. |
| `-hwaccel auto` decode | ~36 % faster than software; used for tier 3 proxy only |
| Tier 3 proxy throughput | ~4.4× realtime with tone-map, ~6.9× without |
| Filmstrip thumbnail | 174–385 ms each, **independent of clip duration** |
