# Mixtape - Technical Document

## 1. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Markup | HTML5 | Single page, `index.html`. Inline SVG sprite for icons. |
| Styling | Plain CSS, custom properties | `css/style.css` (59 lines). Light/dark via `prefers-color-scheme` and a `data-theme` override on `<html>`. |
| Application logic | Vanilla JavaScript, ES modules | Modules under `js/` plus pluggable playback engines in `js/engines/`. Uses top-level `await`. No framework, no bundler, no transpiler. |
| Audio playback | HTML `<audio>` element, YouTube IFrame API, SoundCloud Widget API, Vimeo Player SDK | `js/player.js` picks an engine per track; provider SDKs load lazily. |
| Persistence | IndexedDB | Database `music-player` v2: `local-tracks` (device-only Blobs) and `url-tracks` (links and Cloudinary uploads). |
| Cloud storage | Cloudinary (unsigned upload preset) | `js/cloud-upload.js`; audio/video delivered as MP3 from `res.cloudinary.com`. Config in `config.json`. |
| Settings persistence | `localStorage` | Keys prefixed `music-player:`. |
| OS media integration | Media Session API | Lock-screen and hardware media keys. |
| Track-list generation | Node.js 20, `music-metadata` | `scripts/generate-tracks.mjs` reads ID3/Vorbis tags and embedded cover art. |
| Tests | `node --test` (unit), Playwright (browser) | `tests/unit/*.test.js`; `tests/*.spec.js` with all network stubbed. |
| Local dev server | `scripts/serve.mjs` (Node) | Static server with HTTP range support for seeking. |
| CI/CD | GitHub Actions | `generate-tracks.yml` regenerates `data/tracks.json` on audio pushes. |
| Hosting | GitHub Pages | Static deploy from `main` / root. `.nojekyll` disables Jekyll processing. |

Browser requirements: any evergreen browser that supports ES modules, top-level `await`, IndexedDB, and the `<audio>` element. No polyfills are shipped.

## 2. Architecture

### 2.1 Data flow

The application is built around a single mutable state object and a minimal publish/subscribe mechanism in `js/state.js`:

```
user input / audio events
        |
        v
   setState(patch)  -->  listeners (render, player.sync, media-session, persist)
        ^
        |
   playlist.js / player.js / ui.js
```

Modules never call each other to update the screen. They patch state; subscribers react. This keeps the player, UI, and OS integration decoupled.

### 2.2 Modules

| Module | Responsibility |
|---|---|
| `js/app.js` | Entry point. Restores saved settings, wires modules together, loads repo tracks and local tracks in parallel, persists settings on change. |
| `js/state.js` | State object, `getState`, `setState`, `subscribe`. |
| `js/playlist.js` | Owns `tracks`, `order` (index permutation, reshuffled on shuffle toggle or shuffled wrap-around), and `position`. Skips tracks in `state.failed`. |
| `js/player.js` | Wraps the `<audio>` element. Loads a new `src` when the current track id changes. Translates audio events to state. |
| `js/ui.js` | Sole DOM owner. Diff-renders the playlist and track header; handles file picker, drag-and-drop, theme toggle, and keyboard shortcuts. |
| `js/local-files.js` | IndexedDB CRUD for user-added files; probes duration with a throwaway `<audio>`; parses `Artist - Title` from filenames. |
| `js/media-session.js` | Mirrors state to `navigator.mediaSession`. |
| `js/storage.js` | Safe `localStorage` wrapper. |

### 2.3 Track data model

```json
{
  "id": "majboor",
  "title": "Majboor",
  "artist": "Sheheryar Rehan x Zoha Waseem",
  "src": "assets/audio/majboor.wav",
  "cover": "assets/covers/majboor.jpg",
  "duration": 159,
  "source": "repo"
}
```

`source` is `"repo"` for tracks from `data/tracks.json` and `"local"` for user-added tracks, which are built at runtime with an object URL as `src`. `cover` is omitted when the file has no embedded artwork.

### 2.4 Content pipeline

1. A contributor adds an audio file to `assets/audio/` and pushes to `main`.
2. The GitHub Action installs dependencies and runs `scripts/generate-tracks.mjs`.
3. The script scans `.mp3/.ogg/.m4a/.wav`, derives a slug `id` from the filename, reads tags, writes embedded artwork to `assets/covers/`, and preserves any title/artist already present in the existing `tracks.json` for files without tags.
4. The action commits `data/tracks.json` and `assets/covers/` with `[skip ci]`.

## 3. Development Workflow

```bash
npm install                            # dev dependencies only
npm run serve                          # python3 -m http.server 8000
npm run generate                       # rebuild data/tracks.json locally
npx playwright install chromium        # once
npm test                               # all smoke tests
npx playwright test -g "play button"   # one test
```

The site must be served over HTTP; ES modules and `fetch` do not work from `file://`.

## 4. Current Technical Debt and Known Issues

| # | Issue | Impact | Suggested fix |
|---|---|---|---|
| 1 | ~~Smoke test hard-coded 3 tracks~~ | Resolved: count is read from `tracks.json`. | – |
| 2 | `node_modules/` is committed. | Repository and clone size, noisy diffs on dependency updates. | `.gitignore` now exists; still need `git rm -r --cached node_modules`. |
| 3 | Demo audio is uncompressed WAV (about 74 MB for two tracks). | Slow first load, permanent Git history growth. | Convert to MP3/AAC at 128-192 kbps; consider Git LFS or external hosting. |
| 4 | ~~`python3` hard-coded for the dev server~~ | Resolved: replaced by `scripts/serve.mjs`. | – |
| 5 | README no longer claims public domain, but the demo tracks are still commercial OSTs. | Licensing exposure. | Replace or license the demo tracks. |
| 6 | Shuffle order is regenerated on wrap-around, so "previous" after a wrap does not return to the actual previous track. | Minor UX inconsistency. | Keep a play-history stack for `prev`. |
| 7 | `renderList` rebuilds the whole `<ul>` whenever `tracks`, `order`, `position`, or `failed` changes. | Fine for tens of tracks; would stutter at thousands. | Key rows by id and patch only the changed `aria-current` row. |
| 8 | Unit tests cover URL parsing and upload mapping, but not `playlist.js`. | Shuffle, repeat, failed-skip untested in isolation. | Add Node unit tests for `playlist.js` (it has no DOM dependency). |
| 9 | Local-file ids are `local-<timestamp>-<random>`, so the same file added twice is stored twice. | Wasted storage. | Hash file name + size + lastModified, or compute a content hash. |
| 10 | Duration probing for added files runs serially with an 8 s timeout each. | Adding many files is slow. | Probe in parallel with a concurrency limit. |

## 5. Scope for Improvement

### 5.1 Reliability and tooling (low effort, high value)

- Fix items 1-5 above.
- Add ESLint and Prettier with a `lint` script, and run `npm test` in a CI workflow on every pull request (currently CI only regenerates the track list).
- Add a `.github/workflows/test.yml` that serves the site and runs Playwright in Chromium, Firefox, and WebKit.

### 5.2 Progressive Web App

- Add `manifest.webmanifest` (name, icons, theme colour, `display: standalone`).
- Add a service worker that precaches the shell (`index.html`, CSS, JS, icons) and caches repo audio on first play. The player would then work fully offline and be installable on mobile.

### 5.3 Library management

- Named playlists stored in IndexedDB, with reorder (drag-and-drop) and export/import as JSON or M3U.
- Search and filter in the playlist.
- Read tags client-side for user-added files (for example with `music-metadata-browser` or `jsmediatags`) instead of relying on filename parsing, and display embedded artwork.
- Edit title/artist in place for local tracks.

### 5.4 Playback features

- Gapless or cross-fade transitions using the Web Audio API.
- Playback speed control and A-B loop.
- Equaliser via `BiquadFilterNode`.
- Sleep timer.
- Resume from the last playback position, not only the last track.

### 5.5 Scaling the catalogue

- Support remote catalogues: let `data/tracks.json` (or a configurable URL) point at audio on a CDN or object storage with CORS and range-request support. The README already anticipates this.
- Split the catalogue into pages or lazy-load metadata for large libraries.
- Add Git LFS or move audio out of the repository entirely to keep clones small.

### 5.6 Code quality and maintainability

- Add JSDoc type annotations (or migrate to TypeScript with `tsc --noEmit` for checking only, preserving the no-build-step deployment).
- Extract keyboard-shortcut handling and drag-and-drop from `ui.js` into their own modules; `ui.js` is the largest file and mixes rendering with input handling.
- Introduce a small virtualised list if the playlist is expected to exceed a few hundred tracks.

### 5.7 Accessibility and internationalisation

- Audit with axe or Lighthouse and fix any contrast issues in both themes.
- Add a visible "keyboard shortcuts" help dialog.
- Externalise UI strings for translation (the current audience includes Urdu/Hindi-language content).

## 6. Suggested Roadmap

| Phase | Items | Rationale |
|---|---|---|
| 1 - Hygiene | Fix failing test, `.gitignore`, compress audio, cross-platform dev server, update README | Unblocks contributors and CI; small, safe changes. |
| 2 - Confidence | Unit tests for playlist logic, lint, test workflow in CI | Protects the core behaviour before adding features. |
| 3 - PWA | Manifest + service worker | Biggest user-facing win for a static player: offline and installable. |
| 4 - Library | Client-side tag reading, playlists, search | Turns the player from a demo into a daily-use tool. |
| 5 - Scale | Remote catalogue support, LFS/external hosting | Lets the catalogue grow without hurting the repository. |
