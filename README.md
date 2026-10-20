# Perseverance Rover: New Off-World Distance Record (8-min Three.js video)

An 8-minute (480 s) documentary-style video built entirely with **Three.js / WebGL**, rendered frame by frame on
**GitHub Actions** in three versions: **1080p**, **4K**, and **YouTube Shorts (1080x1920, 58 s)**.

Facts come from NASA/JPL, Space.com, Engadget, PetaPixel and Sky at Night Magazine (Oct 2026): on sol 2,006
(Oct 11, 2026) Perseverance's odometer reached 28.10 mi (45.22 km), passing Opportunity's 28.06 mi (45.16 km).

## Run it on GitHub (recommended)
1. Create a new **public** GitHub repo (public = free Actions minutes) and push this folder.
2. Open **Actions > Render Perseverance video > Run workflow**. Pick `all`, `1080p`, `4k` or `shorts`.
3. When it finishes, download from the run page: `perseverance_record_1080p`, `perseverance_record_4k`,
   `perseverance_record_shorts`, and `thumbnail`.

Rendering uses software WebGL (no GPU on runners), so it is slow but fully deterministic. Expect roughly:
1080p about 1 h, 4K 2 to 4 h, Shorts about 10 min of wall-clock time (jobs run in parallel, 40 s / 20 s chunks).
Private repos use paid minutes, so use a public repo or run only `shorts` / `1080p`.

## Voice-over and music
* Music, wind and impacts are generated procedurally (`scripts/make_audio.py`), no copyright issues.
* Narration uses free Microsoft Edge neural TTS (`en-IN-PrabhatNeural` by default; change `voice` in the run dialog).
  If TTS is unreachable the video ships with music only. You can also record your own voice-over: the script is in
  `data/timeline.json` (`say` fields) and the timing of every line is in the same file.

## Local preview / test
```bash
npm install
node scripts/serve.mjs                       # open http://localhost:8080/index.html?t=125&w=1280&h=720
node render.mjs --format test --still 8,125,170 --out out/stills/f_%t.jpg
node render.mjs --format 1080p --start 120 --end 124 --out out/try     # short test clip
node render.mjs --thumbnail --out out/thumbnail.jpg
```
Needs Node 20+, ffmpeg, and Chrome/Chromium (set `CHROME_PATH` if not auto-detected).

## Structure
| Path | What it does |
|---|---|
| `src/world.js` | Procedural Mars terrain, rover path, odometer, sun keyframes |
| `src/terrain.js` | Moving high-res terrain window, rocks, wheel tracks |
| `src/rover.js` | Perseverance, Opportunity, sky crane models |
| `src/space.js` | Sky shader, stars, Mars globe, orbital route map |
| `src/shots.js` | All camera angles (chase, low wheel, drone, fly-by, crane, orbit, mast POV, top-down...) |
| `src/main.js` | Scene, lighting, HUD overlays (captions, odometer, AutoNav, leaderboard) |
| `data/timeline.json` | Scenes, captions, narration lines, Shorts cut, chapters |
| `render.mjs` | Headless Chrome frame renderer + ffmpeg encoder |
| `.github/workflows/render.yml` | Chunked parallel render, audio, assembly |

## Notes
* The orbital route map in Chapter 07 is **illustrative** (labelled on screen), not real HiRISE imagery.
* Landscapes are procedural; the rover models are simplified, not exact NASA CAD.
* To tweak anything, edit `data/timeline.json` (text/timing) or the files above and re-run the workflow.
