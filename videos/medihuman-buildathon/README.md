# MediHuman buildathon video

## Deliverable

- `renders/video.mp4` — 90 seconds, 1920×1080, 30 fps, H.264 video and AAC narration.
- `renders/verification.jpg` — decoded MP4 contact sheet used for visual verification.
- `boards/stills/contact-sheet.jpg` — pre-render scene contact sheet.
- `index.html` and `compositions/` — editable HyperFrames source.

The film is a **stylised product explainer**, not a live screen recording. Interface
illustrations use MediHuman's copy and design vocabulary, simplified for video.
Localhost automated capture failed, so no captured screens are claimed. Illustrative
lists contain no real patient information. Narration and captions explain the
capture → verify → compare → organise → patient-controlled access flow.

## Setup

Run these commands from `videos/medihuman-buildathon`:

```sh
nvm install
nvm use
npm ci
npm exec -- hyperframes browser ensure
```

Node 22.14.0 is pinned in `.nvmrc` and the project-local Node dependency. HyperFrames
0.8.181, GSAP 3.14.2 and Inter 5.2.8 are pinned in `package-lock.json`. Setup requires
network access; rendering uses committed narration, local fonts and local GSAP.
Install FFmpeg and Chrome system dependencies using the supplied Dockerfile on Linux.
No HeyGen login, API key, Python environment or external agent skill is needed to
re-render the checked-in composition. Voice assets and timestamp metadata are frozen.

## Test, preview and render

```sh
npm test               # offline structural/asset checks; no browser or network
npm run check          # full HyperFrames browser audit after setup
npm run dev -- --port 3017
npm run render -- --workers 4
```

Preview: `http://localhost:3017/#project/medihuman-buildathon`. Preview is an editable
timeline and stays running in the background. Stop it with:

```sh
npm exec -- hyperframes preview --stop
```

`npm run render` writes `renders/video.mp4`. Narration clips deliberately end before
their scene slots, leaving time to read the interface; media-fit warnings reflect
those holds. Numeric scene IDs use escaped or attribute selectors. Checks passed
with non-blocking Studio-ID and contrast warnings; no runtime/layout errors.

## Clean Linux container

From this video directory:

```sh
docker build --platform linux/amd64 -t medihuman-video .
docker run --rm --platform linux/amd64 --network none medihuman-video npm test
docker run --rm --platform linux/amd64 --shm-size=1g \
  --mount "type=bind,source=$(pwd)/renders,target=/video/renders" medihuman-video
```

`renders/` already exists in the repository. The AMD64 platform is explicit because
the pinned Chrome distribution supports Linux x64. Docker installs every system
dependency and the pinned browser during the build. No credentials enter the image.
Pixel/encoder identity across macOS and Linux is not claimed.

## Submit / deploy

Upload **only `renders/video.mp4`** to the buildathon's video submission surface, or
serve it from static/object storage using `video/mp4`. This does not deploy or alter
the healthcare app. Never upload local caches, account configuration or real patient
records. Source edits should be checked and rendered again before replacing output.

## Provenance

- Voice: HeyGen Starfish, Jonah — Clear & Professional; eight frozen WAV clips.
- Captions: actual provider word timestamps, grouped into a lower-third overlay.
- Music: none; narration-only soundtrack.
- Font: Inter; licence included at `assets/fonts/OFL.txt`.
- Animation runtime: local GSAP; package header retains its licence notice.
- Story: `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`.
