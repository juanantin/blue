# Originals

The artwork as it was handed over, kept so every derived file can be remade
without asking for it again. Nothing in here is served by the page — the site
loads only the derived files one directory up.

| File | What it is | What comes from it |
|---|---|---|
| `../blue_icon.png` | The bull cut out on transparency, 1000×853, supplied as the mark | every icon: `images/favicon.png`, `icon-192`, `icon-512`, `apple-touch-icon`, `/favicon.ico` — trimmed to its own alpha bounds, padded to a square with 4% air |
| `bull_mark.png` | The voxel bull on its white scene, 994×996 | nothing now; it was the icon source before a cut-out was supplied |
| `blue_banner_master.mp4` | The header clip as delivered: 960×304, 10s, **with** an audio track | `images/blue_banner.mp4` (audio stripped, CRF 26, faststart — 3.3 MB → 0.9 MB) and `images/blue_banner_poster.webp` (its own first frame) |
| `../blue_banner.jpg` | The banner as a still, 1280×426 (3:1), supplied for sharing | `images/blue_social.jpg` — the same art letterboxed to 1200×630, because a 3:1 image loses its wordmark to a card crop |
| `blue_trailer.MOV` | A 24s 1280×720 trailer, with sound | `images/blue_trailer.mp4` (H.264 in an mp4 container — a .MOV is not reliably playable outside Safari; 7.8 MB → 3.8 MB) and `images/blue_trailer_poster.webp` (the frame at 8s) |

Remaking them needs ffmpeg:

```bash
ffmpeg -i images/src/blue_banner_master.mp4 -map 0:v:0 -an \
       -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
       images/blue_banner.mp4
ffmpeg -i images/src/blue_banner_master.mp4 -map 0:v:0 -frames:v 1 first.png
```

```bash
ffmpeg -i images/src/blue_trailer.MOV -vf scale=1280:-2 \
       -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p \
       -c:a aac -b:a 96k -movflags +faststart images/blue_trailer.mp4
ffmpeg -ss 8 -i images/src/blue_trailer.MOV -frames:v 1 trailer-still.png
```

```bash
# the social card: letterbox, never crop — the ground is the mode of the
# banner's own border, so the join is invisible
python3 - <<'EOF'
from PIL import Image
src = Image.open('images/blue_banner.jpg').convert('RGB')
card = Image.new('RGB', (1200, 630), (252, 252, 252))
art = src.resize((1200, round(src.height * 1200 / src.width)), Image.LANCZOS)
card.paste(art, (0, (630 - art.height) // 2))
card.save('images/blue_social.jpg', 'JPEG', quality=88, optimize=True)
EOF
```

```bash
# every icon, from the supplied cut-out
python3 - <<'EOF'
from PIL import Image
src = Image.open('images/blue_icon.png').convert('RGBA')
art = src.crop(src.split()[-1].getbbox())        # trim to the alpha bounds
side = max(art.size) + round(max(art.size) * 0.04)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)
for path, size in (('images/favicon.png',128), ('images/icon-192.png',192), ('images/icon-512.png',512)):
    sq.resize((size, size), Image.LANCZOS).save(path, optimize=True)
apple = Image.new('RGB', (180,180), (255,255,255))          # iOS paints transparency black
apple.paste(sq.resize((180,180), Image.LANCZOS), (0,0), sq.resize((180,180), Image.LANCZOS))
apple.save('images/apple-touch-icon.png', optimize=True)
sq.resize((48,48), Image.LANCZOS).save('favicon.ico', sizes=[(16,16),(32,32),(48,48)])
EOF
```

Then `node scripts/stamp.mjs`, which moves every `?v=` in `index.html` so
browsers drop the icon they have cached.

**The HEADER poster must stay the clip's own first frame.** It autoplays, so
any other still makes the hand-off from poster to playback jump. The trailer
is the opposite case — it waits for a click, and its own first frame is an
out-of-focus cube — so its poster is deliberately a frame from the middle.
