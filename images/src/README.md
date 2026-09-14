# Originals

The artwork as it was handed over, kept so every derived file can be remade
without asking for it again. Nothing in here is served by the page — the site
loads only the derived files one directory up.

| File | What it is | What comes from it |
|---|---|---|
| `bull_mark.png` | The voxel bull, 994×996 | `images/favicon.png`, `icon-192`, `icon-512`, `apple-touch-icon`, `/favicon.ico` — all cropped to the head, because the full scene reads as noise at 16px |
| `blue_banner_master.mp4` | The header clip as delivered: 960×304, 10s, **with** an audio track | `images/blue_banner.mp4` (audio stripped, CRF 26, faststart — 3.3 MB → 0.9 MB) and `images/blue_banner_poster.webp` (its own first frame) |
| `blue_trailer.MOV` | A 24s 1280×720 trailer | nothing yet — the page has no place for it |

Remaking them needs ffmpeg:

```bash
ffmpeg -i images/src/blue_banner_master.mp4 -map 0:v:0 -an \
       -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
       images/blue_banner.mp4
ffmpeg -i images/src/blue_banner_master.mp4 -map 0:v:0 -frames:v 1 first.png
```

**The poster must stay the clip's own first frame.** Any other still makes the
hand-off from poster to playback jump.
