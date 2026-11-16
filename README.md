# Music Player

A browser music player with a playlist. Plain HTML, CSS and JavaScript; no build step.

- Plays the demo tracks in this repository.
- **Add files** uploads your audio or video to Mixtape's cloud storage (Cloudinary) and plays it back as audio by URL. If an upload fails or you are offline, you can keep the file on your device only.
- **Add link** (or just paste a link on the page) plays a direct audio/video URL, or a SoundCloud, YouTube, Vimeo or Spotify track, as audio. Spotify plays through Spotify's own embedded player: you hear the full track if you are logged in to Spotify in that browser, otherwise a 30-second preview, and its volume is set inside the Spotify player. A Spotify album, playlist, podcast or artist link becomes one playlist row that plays through the whole collection; the Now Playing panel names the current item, and Mixtape moves to the next row when the collection ends. Facebook, Instagram and TikTok links and `spotify.link` short links are not supported.

**Live:** `https://<username>.github.io/music-player/`

## Run locally

```bash
npm run serve            # http://localhost:8000  (Node static server with range support)
```

The app must be served over HTTP; opening `index.html` from disk will not work.

## Add a song to the repository playlist

1. Put the file in `assets/audio/` (lowercase name, no spaces, e.g. `my-song.mp3`).
2. Push to `main`. The GitHub Action regenerates `data/tracks.json` from the file's tags.
   To do it by hand: `npm install && npm run generate`.

Keep repo audio small (a few demo tracks). Larger libraries can be hosted elsewhere and referenced by `https://` URL in `data/tracks.json` (the host must allow range requests).

## Cloud uploads (Cloudinary)

`config.json` holds only public values: the cloud name and an **unsigned upload preset**. No API key or secret is used by the site; never commit one. To run a fork without Cloudinary, set `cloudName` to `""` and Add files will store on the device only.

Owner setup lives in `plan.md`, section 15. The public playlist (tracks tagged `mixtape-public`) only appears if "Resource list" is enabled in the Cloudinary console.

If you believe something uploaded here infringes your rights, open an issue on this repository and it will be removed.

## Privacy

- **Usage log.** When `audit.endpoint` is set in `config.json`, Mixtape keeps a usage log that only the site owner can read: each visit's IP address, approximate location (from Cloudflare) and browser/device details; the links and files a visitor adds (file names and details, never the audio of device-only files); and what is played, for how long, and whether it finished. A notice is shown on the first visit and the Privacy link at the bottom of the page explains this and shows the visitor id.
- **Where and how long.** The log is stored in a Cloudflare D1 database behind the Worker in `collector/`. Sessions and events are deleted after 365 days. The catalogue of links is kept, with the IP address and visitor id removed at the same age.
- **Deletion.** Open an issue on this repository and quote the visitor id from the Privacy panel; the owner removes that visitor's records.
- **Other services.** Uploaded files are stored by Cloudinary and can be played by anyone who has the URL. YouTube, SoundCloud, Vimeo and Spotify players load from those services under their own policies. Settings and the personal playlist stay in the browser.

To run a fork without the usage log, leave `audit.endpoint` empty. Collector deployment and the queries for reading the log are in `collector/README.md`.

## Keyboard shortcuts

Space play/pause · ←/→ seek 5 s · ↑/↓ volume · N next · P previous · M mute · Ctrl/Cmd+V paste a link

## Deploy

Settings → Pages → Deploy from a branch → `main` / root.

## Tests

```bash
npm install
npx playwright install chromium   # once
npm test                          # unit tests (node --test) then Playwright
npm run test:unit                 # unit tests only
npx playwright test -g "YouTube"  # one browser test by title
```

Browser tests stub `config.json`, Cloudinary, the audit collector and the YouTube SDK, so they never touch the network.

## Credits

The demo tracks in `assets/audio/` are OST recordings; see `business_document.md` for licensing notes.
