# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static browser music player (plain HTML/CSS/ES modules, no build step, no framework) deployed via GitHub Pages from `main` / root. `package.json` exists only for the track-list generator and tests; the app itself has no runtime dependencies. `node_modules/` is committed to the repo (it is now in `.gitignore`, but has not been removed from the index).

## Commands

```bash
npm install                              # devDeps only: @playwright/test, music-metadata
npm run serve                            # node scripts/serve.mjs 8000 (static server with HTTP range support)
npm run generate                         # regenerate data/tracks.json from assets/audio/ (+ extract covers)
npx playwright install chromium          # once, before first browser test run
npm test                                 # unit tests then Playwright
npm run test:unit                        # node --test tests/unit/*.test.js (no browser)
npx playwright test tests/links.spec.js -g "YouTube"   # single browser test by title
```

The app must be served over HTTP (ES modules + `fetch`); opening `index.html` from disk will not work. There is no Python on the dev machine; the Node server replaces `python3 -m http.server`.

## Architecture

Everything flows through a single mutable state object with a pub/sub `setState` (`js/state.js`). Modules never call each other to update the UI; they patch state and subscribers react:

- `js/app.js` — entry point (top-level `await`). Loads `config.json`, restores persisted settings, wires `player`, `ui`, and `media-session`, then loads four track sources in parallel: repo (`data/tracks.json`), Cloudinary shared list, local IndexedDB files, and URL tracks. Persists `{volume, muted, shuffle, repeat, last}` to `localStorage` on every change.
- `js/playlist.js` — owns `tracks`, `order` (array of indices into `tracks`; reshuffled when shuffle toggles or a shuffled loop wraps), and `position` (index into `order`). `current()` = `tracks[order[position]]`. `next()` skips ids in `state.failed`.
- `js/player.js` — facade over pluggable **engines** in `js/engines/`. Picks an engine by `track.provider` (`youtube` / `soundcloud` / `vimeo`, anything else → `html-audio`), destroys the old one on provider change, and mirrors engine events into state. Public API (`init/play/pause/toggle/seek/seekBy/setVolume/toggleMute`) is what `ui.js` and `media-session.js` use.
- `js/engines/*.js` — one object per provider implementing `load/play/pause/seek/setVolume/setMuted/currentTime/duration/destroy` and reporting through `handlers.{onTime,onDuration,onPlay,onPause,onEnded,onError,onBlocked}`. Provider SDKs load lazily via `engines/sdk.js` the first time they are needed. The YouTube player must stay visible (API terms): it renders in `#embed` inside `.cover`, shown via `data-embed="youtube"`.
- `js/ui.js` — the only module that touches the DOM. One `render(state)` subscriber diffs against `last` to avoid re-rendering the list on every `timeupdate`. Owns the two `<dialog>`s (Add link, Upload files), paste-to-add, drag-and-drop, theme, keyboard shortcuts.
- `js/url-tracks.js` — `parse()` classifies a pasted URL (pure, unit-tested), `describe()` fetches oEmbed metadata (provider endpoint, then noembed.com fallback) or probes direct links, `save/loadAll/remove` persist records in IndexedDB store `url-tracks`. Cloudinary uploads are stored here too (`provider: "cloudinary"`).
- `js/cloud-upload.js` — unsigned Cloudinary upload via XHR (for progress), `validate()` against `config.json` limits, `toRecord()` maps the response to a URL track (`<public_id>.mp3` delivery URL, `fl_waveform` cover), `loadShared()` reads the tag-based resource list.
- `js/local-files.js` — device-only fallback: Blobs in IndexedDB store `local-tracks`. `js/db.js` owns the database (version 2, both stores). `js/probe.js` reads a duration with a throwaway `<audio>`.
- `js/media-session.js`, `js/storage.js` — unchanged helpers.

Track shape: `{ id, title, artist, src, cover, duration, source: "repo"|"local"|"url"|"shared", provider?: "direct"|"youtube"|"soundcloud"|"vimeo"|"cloudinary", externalId? }`. Ids are deterministic for URL tracks (`url-<provider>-<id|hash>`, `cloud-<public_id>`), which is how duplicates are prevented.

### Track list pipeline

`data/tracks.json` is generated, not hand-edited. `scripts/generate-tracks.mjs` scans `assets/audio/`, derives `id` from the filename, reads tags with `music-metadata`, writes embedded cover art to `assets/covers/`, and falls back to the title/artist already in the existing `tracks.json` for untagged files. `.github/workflows/generate-tracks.yml` runs it on pushes touching `assets/audio/**` and commits with `[skip ci]`.

### Cloudinary

`config.json` is public and safe to commit: cloud name `tivkdskh`, unsigned preset `mixtape-unsigned`. Never add an API key or secret anywhere in this repo; server-side work (signed uploads, deletes, the resolver in `plan.md` §17) belongs in a separate function with its own env. Audio uploads use `resource_type: video`.

## Testing notes

Browser tests must never hit the network: they stub `config.json` (`{}` disables cloud upload), `api.cloudinary.com`, `res.cloudinary.com`, oEmbed endpoints, and inject a fake `window.YT` via `addInitScript`. `tests/fixtures/tone.wav` is a generated 2-second 440 Hz tone used as both a direct link and an upload. The smoke test derives the expected playlist length from `data/tracks.json`, so adding repo tracks does not break it.
