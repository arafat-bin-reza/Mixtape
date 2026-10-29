# Music Player

A browser music player with a playlist. Plain HTML, CSS and JavaScript; no build step. Add your own audio files from your device. Nothing is uploaded.

**Live:** `https://<username>.github.io/music-player/`

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Add a song to the playlist

1. Put the file in `assets/audio/` (lowercase name, no spaces, e.g. `my-song.mp3`).
2. Push to `main`. The GitHub Action regenerates `data/tracks.json` from the file's tags.
   To do it by hand: `npm install && npm run generate`.

Keep repo audio small (a few demo tracks). Users can add their own files in the app, and larger libraries can be hosted elsewhere and referenced by `https://` URL in `data/tracks.json` (the host must allow CORS and range requests).

## Keyboard shortcuts

Space play/pause · ←/→ seek 5 s · ↑/↓ volume · N next · P previous · M mute

## Deploy

Settings → Pages → Deploy from a branch → `main` / root.

## Tests

`npm install && npx playwright install chromium && npm test`

## Credits

The three demo tracks in `assets/audio/` were synthesized for this project and are released to the public domain.
