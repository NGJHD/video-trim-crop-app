# Third-party notices

Video Trim & Crop's own source code is MIT licensed (see `LICENSE`). That
licence file is the plain MIT text and covers **this project's source only** —
it does not cover the bundled FFmpeg described below.

The **distributed application** additionally bundles FFmpeg, which is under the
GNU General Public License. That is a different licence with real obligations,
and they attach to the zip you hand to other people — not to this repository,
which contains no FFmpeg binaries.

---

## FFmpeg

| | |
| --- | --- |
| Project | FFmpeg — https://ffmpeg.org |
| Files bundled | `ffmpeg.exe`, `ffprobe.exe` (in `resources/bin`) |
| Build used | BtbN static win64 GPL build — https://github.com/BtbN/FFmpeg-Builds |
| Version | run `resources/bin/ffmpeg.exe -version`; the exact string is recorded in the release notes |
| Licence | **GNU GPL v3** |
| Modified? | **No.** Bundled unmodified, exactly as published. |

FFmpeg is LGPL v2.1+ by default, but this build is configured with
`--enable-gpl` (required for **libx264**, which the render spec depends on) and
`--enable-version3`. Together those make the resulting binaries **GPL v3**.

Notable GPL components in the build: **libx264**, **libx265**, **libzimg**
(which provides the `zscale` filter used for HDR tone-mapping).

## What you must do when you distribute the app

These apply to the release zip, because it contains the FFmpeg binaries.

1. **Keep this file and `LICENSE` in the distributed folder.** They ship
   alongside the exe automatically.
2. **Include the full GPL v3 text.** https://www.gnu.org/licenses/gpl-3.0.txt
3. **Offer the corresponding source.** Anyone receiving the binary is entitled
   to the source for the GPL parts. In practice, state in the release notes:
   - the exact FFmpeg version bundled (`ffmpeg -version`),
   - a link to https://github.com/BtbN/FFmpeg-Builds for the build scripts and
     configuration, and
   - a link to https://ffmpeg.org/download.html for the source.

   A link is acceptable because the binaries are unmodified upstream builds.
   If you ever patch FFmpeg yourself, you must publish your modified source.
4. **State that FFmpeg is GPL and not covered by this project's MIT licence.**

Suggested line for the release notes:

> Bundles unmodified FFmpeg (GPL v3) — build:
> https://github.com/BtbN/FFmpeg-Builds · source: https://ffmpeg.org/download.html

## Why this project's own code can stay MIT

The app never links against FFmpeg. It **spawns `ffmpeg.exe` as a separate
process** and communicates with it only through command-line arguments, exit
codes and pipes — see `src/main/jobs.js`, which is the only place a child
process is created.

Under the FSF's own guidance, programs that merely run at arm's length like
this are separate works rather than a single combined program, so the GPL does
not reach back into this codebase. This is the same arrangement many
applications that ship FFmpeg rely on. The FFmpeg binaries remain GPL and carry
their obligations with them; the code in `src/` remains MIT.

Two things would change that conclusion, so avoid both:

- linking FFmpeg's libraries directly (libavcodec and friends) instead of
  invoking the executable, or
- modifying FFmpeg and shipping your build without publishing the source.

## Not legal advice

This is a plain-language summary written to be practical, not a legal opinion.
If the app is ever distributed commercially or at scale, have someone qualified
review it.
