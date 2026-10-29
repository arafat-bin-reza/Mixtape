# Music Player with Playlist: Project Plan (v2)

A static, browser-based audio player with a playlist, built with plain HTML, CSS and JavaScript (no frameworks, no build step for the app itself) and deployed on GitHub Pages.

**What changed in v2:** deploy on day one, stop bundling all audio in the repo, make "add local files" a core feature, auto-generate the playlist, use a small state store, and defer audio caching in the PWA.

---

## 1. Goals

- Play audio tracks from a playlist with standard controls.
- Let users build their own playlist from files on their device.
- Look good and work well on desktop and mobile.
- Need no backend, so it can be hosted free on GitHub Pages.
- Keep the code simple, modular and easy to extend.

### Non-goals (for v1)

- User accounts or server-side storage.
- Streaming from paid services (Spotify, etc.).
- Uploading files to a server.

---

## 2. Feature List

### Must have (MVP)

- [ ] Play / Pause
- [ ] Next / Previous track
- [ ] Playlist as a clickable list; current track highlighted
- [ ] Track info: title, artist, cover art
- [ ] Progress bar with seeking, plus current time / duration
- [ ] Volume slider and mute toggle
- [ ] Auto-advance when a track ends
- [ ] Responsive layout
- [ ] Live on GitHub Pages from the first milestone

### Should have

- [ ] Shuffle and repeat (off / repeat all / repeat one)
- [ ] Add local audio files from the user's device (persisted with IndexedDB)
- [ ] Keyboard shortcuts (Space = play/pause, arrows = seek/volume, N/P = next/previous)
- [ ] Remember last track, volume, shuffle and repeat (`localStorage`)
- [ ] Media Session API (lock-screen and media-key controls)
- [ ] Error handling for missing or unplayable files
- [ ] Auto-generated `tracks.json` from the audio folder (script + GitHub Actions)

### Nice to have

- [ ] Drag-and-drop playlist reordering
- [ ] Search/filter within the playlist
- [ ] Dark / light theme (follows `prefers-color-scheme`, with a manual toggle)
- [ ] Audio visualizer (Web Audio API `AnalyserNode` + `<canvas>`)
- [ ] Installable PWA (app shell caching only at first)
- [ ] Import / export playlist as JSON

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Markup | HTML5 | Semantic elements, native `<button>` and `<input type="range">` |
| Styling | CSS3 | Custom properties, Flexbox/Grid, media queries |
| Logic | Vanilla JavaScript (ES modules) | No dependencies |
| Local storage | `localStorage` + IndexedDB | Settings in `localStorage`; user audio files in IndexedDB |
| Tooling (optional) | Node script + GitHub Actions | Generates `tracks.json` from ID3 tags |
| Testing (optional) | Playwright | A few end-to-end smoke tests |
| Hosting | GitHub Pages | Static hosting from the repository |

---

## 4. Project Structure

```
music-player/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js            # entry point, wires everything together
│   ├── state.js          # single state store with subscribe()
│   ├── player.js         # audio logic (play, pause, seek, volume)
│   ├── playlist.js       # track order, shuffle, repeat
│   ├── ui.js             # DOM rendering and event binding
│   ├── storage.js        # localStorage helpers
│   ├── local-files.js    # file input + IndexedDB persistence
│   └── media-session.js  # lock-screen / media-key integration
├── data/
│   └── tracks.json       # playlist metadata (hand-written or generated)
├── assets/
│   ├── audio/            # a few small demo tracks only
│   ├── covers/
│   └── icons/            # favicon, app icons
├── scripts/
│   └── generate-tracks.mjs   # reads ID3 tags, writes data/tracks.json
├── tests/
│   └── smoke.spec.js     # Playwright tests
├── .github/
│   └── workflows/
│       └── generate-tracks.yml
├── .nojekyll
├── plan.md
└── README.md
```

**Tip:** use lowercase file names with no spaces (e.g. `track-01.mp3`). GitHub Pages is case-sensitive, so `Song.mp3` and `song.mp3` are different files.

---

## 5. Data Model

### Tracks (`data/tracks.json`)

```json
[
  {
    "id": "track-01",
    "title": "Track Title",
    "artist": "Artist Name",
    "src": "assets/audio/track-01.mp3",
    "cover": "assets/covers/track-01.jpg",
    "duration": 215,
    "source": "repo"
  }
]
```

- `source` is `"repo"`, `"remote"` (external URL) or `"local"` (user's device).
- Repo paths are **relative** (no leading `/`) so they work under `https://<user>.github.io/<repo>/`.
- Remote URLs must be `https://` and the host must allow cross-origin audio playback and byte-range requests, or seeking will break.
- `duration` is optional; it can be read from the audio metadata at runtime.

### App state (`state.js`)

```js
{
  tracks: [],          // repo/remote + local tracks, merged
  order: [],           // play order (indexes into tracks); shuffled when shuffle is on
  position: 0,         // index into order
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",       // "off" | "all" | "one"
  error: null
}
```

### Local files (IndexedDB)

- Store the `File`/`Blob` plus metadata (title, artist, duration, added date) in an object store named `local-tracks`.
- Create a playable URL with `URL.createObjectURL(blob)` at load time and revoke it when the track is removed.
- Metadata can be read from the filename, or from ID3 tags with a small library if desired.

---

## 6. Audio Hosting Strategy

Committing lots of audio to the repo bloats it and slows every clone. Use a tiered approach:

1. **Demo tracks in the repo:** 3 to 5 small, licensed tracks (128 kbps MP3, about 3 to 5 MB each) so the live demo works immediately.
2. **Local files:** the user adds their own music from their device. Nothing is uploaded, so there are no hosting or copyright concerns for you.
3. **Optional external hosting:** a larger library can live on Internet Archive, Cloudflare R2 or GitHub Releases, referenced by URL in `tracks.json`. Test CORS and range-request support before relying on a host.

Notes:
- Git rejects any single file over 100 MB, and Pages sites are limited to about 1 GB.
- Git LFS does not serve files properly through GitHub Pages, so avoid it.
- Only publish audio you have the right to distribute. Good sources: your own recordings, public-domain or Creative Commons music (Free Music Archive, Internet Archive, Pixabay Music, Incompetech), following each license's attribution rules. Add a Credits section in the README or UI.

---

## 7. UI Design

### Layout

```
┌──────────────────────────────┐
│          Cover Art           │
│        Track Title           │
│        Artist Name           │
│  ───────●────────  1:23/3:45 │
│  🔀  ⏮   ▶/⏸   ⏭   🔁       │
│  🔊 ──────●──                │
├──────────────────────────────┤
│ Playlist            [+ Add]  │
│  1. Track One       3:45     │
│  2. Track Two  ← playing     │
│  3. Track Three     2:58     │
└──────────────────────────────┘
```

- **Desktop:** player and playlist side by side (two-column grid).
- **Mobile:** stacked, with the player on top and the playlist scrolling below.
- CSS custom properties (`--bg`, `--accent`, `--text`) for theming; `prefers-color-scheme` for automatic dark mode; `prefers-reduced-motion` respected for any animation.
- Use native elements (`<button>`, `<input type="range">`) so keyboard and screen-reader support comes mostly for free; add `aria-label` on icon-only buttons and an `aria-live` region for track changes.
- Visible focus styles and sufficient color contrast.
- Lazy-load cover images; use `preload="metadata"` on audio.
- Add a favicon and Open Graph tags (title, description, image) so shared links look good.

---

## 8. JavaScript Architecture

### State store

A tiny store keeps one source of truth:

```js
// state.js
const state = { /* see section 5 */ };
const listeners = new Set();

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}
```

Flow: **user action → player/playlist function → `setState` → subscribers (UI, storage, Media Session) react.** The modules no longer call each other directly.

### Modules

- **`player.js`**: wraps a single `Audio` object; exposes `load`, `play`, `pause`, `toggle`, `seek`, `setVolume`; translates audio events (`timeupdate`, `ended`, `error`, `loadedmetadata`) into `setState` calls.
- **`playlist.js`**: builds `order` (shuffled with Fisher-Yates when shuffle is on), implements `next()`, `prev()`, `select()`, and the repeat rules.
- **`ui.js`**: subscribes to state, renders the playlist, progress, time labels and icons; binds click, input and keyboard events.
- **`storage.js`**: `save` / `load` with `try/catch` around `localStorage`.
- **`local-files.js`**: file picker and drag-and-drop, IndexedDB read/write, object URL management.
- **`media-session.js`**: subscribes to state; sets `navigator.mediaSession.metadata` and the `play`, `pause`, `previoustrack`, `nexttrack`, `seekto` handlers.
- **`app.js`**: loads `tracks.json`, restores saved state and local tracks, initializes the modules.

### Key behaviors

1. **Autoplay policy:** never auto-play on page load; wait for the first user click.
2. **Track end:** repeat one replays; repeat all wraps to the first track; off stops at the last track.
3. **Seeking:** the progress bar is an `<input type="range">`; pause `timeupdate` writes while the user drags.
4. **Errors:** on `error`, show a message on that track and skip to the next playable one.
5. **Shuffle:** keep a shuffled `order` array so Previous works and no track repeats until all have played.
6. **Local files:** revoke object URLs when tracks are removed to avoid memory leaks.
7. **Time formatting:** helper `formatTime(seconds)` returns `m:ss`.

---

## 9. Automating the Playlist

Hand-editing `tracks.json` does not scale. Add a script and a workflow:

**`scripts/generate-tracks.mjs`**
- Scan `assets/audio/` for `.mp3` / `.ogg` / `.m4a` files.
- Read ID3 tags (title, artist, duration, embedded cover) with a library such as `music-metadata`.
- Extract covers to `assets/covers/` and write `data/tracks.json`.
- Fall back to the file name when tags are missing.

**`.github/workflows/generate-tracks.yml`**
- Trigger on pushes that change `assets/audio/**`.
- Run the script, then commit the updated `data/tracks.json` back to the branch.
- Result: dropping a new song into the folder and pushing is all it takes.

Keep the script runnable locally (`node scripts/generate-tracks.mjs`) so the workflow is optional.

---

## 10. Development Milestones

### Milestone 0: Deploy a skeleton (≈ 30 min)
- [ ] Create the repository and folder structure
- [ ] Add a minimal `index.html` ("Music Player coming soon") and `.nojekyll`
- [ ] Push to `main`, enable Pages, confirm the live URL works

### Milestone 1: Static UI (≈ 1 hour)
- [ ] Full `index.html` markup for player and playlist
- [ ] `style.css` (layout, colors, responsive rules, dark mode)
- [ ] Push and check on the live URL and on a phone

### Milestone 2: Core playback (≈ 2 hours)
- [ ] `tracks.json` with 3 demo tracks
- [ ] `state.js`, `player.js`, `playlist.js`
- [ ] Render the playlist; highlight the active track
- [ ] Play, pause, next, previous, seek, volume, auto-advance

### Milestone 3: Enhanced controls (≈ 2 hours)
- [ ] Shuffle and repeat modes
- [ ] Keyboard shortcuts
- [ ] Error handling for broken tracks
- [ ] Save and restore volume, last track, shuffle and repeat

### Milestone 4: Local files (≈ 2 hours)
- [ ] File picker and drag-and-drop for audio files
- [ ] IndexedDB persistence; reload restores the user's tracks
- [ ] Remove-track button; object URL cleanup
- [ ] Handle unsupported formats and storage-quota errors gracefully

### Milestone 5: Automation (≈ 1 to 2 hours)
- [ ] `generate-tracks.mjs` script
- [ ] GitHub Actions workflow to regenerate `tracks.json`
- [ ] Document the "add a song" workflow in the README

### Milestone 6: Polish and extras (≈ 2 to 3 hours)
- [ ] Media Session API integration
- [ ] Accessibility pass (labels, focus order, contrast, live regions)
- [ ] Open Graph tags, favicon, loading and empty states
- [ ] Playwright smoke tests
- [ ] Optional: PWA with app-shell caching

### Local development

`fetch()` of local JSON does not work from `file://`. Run a static server from the project folder:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`. (The VS Code "Live Server" extension also works.)

---

## 11. Deploying to GitHub Pages

1. **Create the repository** (e.g. `music-player`), public (free Pages requires public repos unless you have a paid plan).
2. **Push the project:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Pages skeleton"
   git branch -M main
   git remote add origin https://github.com/<username>/music-player.git
   git push -u origin main
   ```
3. **Enable Pages:** repository **Settings → Pages → Build and deployment**. Set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, then **Save**.
4. **Wait 1 to 2 minutes**, then open `https://<username>.github.io/music-player/`.
5. **Every push to `main` redeploys automatically.** Check the live URL after each milestone.

### Deployment checklist

- [ ] `index.html` is in the repository root
- [ ] All paths are relative (`css/style.css`, not `/css/style.css`)
- [ ] File names match exactly, including case
- [ ] Audio files are committed and not ignored by `.gitignore`
- [ ] External resources use `https://` (no mixed content)
- [ ] `.nojekyll` is present in the root
- [ ] If the Actions workflow commits to `main`, confirm it does not trigger itself in a loop

### PWA notes (if added)

- Cache only the app shell (HTML, CSS, JS, icons) at first.
- Avoid caching audio initially: seeking uses range requests, which the Cache API handles poorly. If offline audio is wanted later, handle range requests explicitly in the service worker.
- Service worker scope depends on the repo path (`/music-player/`), so register it with a relative URL.

---

## 12. Testing Plan

**Functional**
- [ ] Play, pause, next, previous, select from the list
- [ ] Seeking by click and drag
- [ ] Volume and mute
- [ ] Shuffle never repeats a track until all have played
- [ ] Repeat modes behave correctly at the end of the playlist
- [ ] Settings persist after reload
- [ ] Local files persist after reload and can be removed
- [ ] A missing or corrupt audio file shows an error and does not break the app

**Automated (Playwright smoke tests)**
- [ ] Page loads with no console errors
- [ ] Clicking Play toggles the button state
- [ ] Next changes the highlighted track
- [ ] Shuffle and repeat buttons toggle their state

**Compatibility**
- [ ] Chrome, Firefox, Safari, Edge (latest)
- [ ] iOS Safari and Android Chrome (autoplay rules, layout, file picker)
- [ ] MP3 works everywhere; add OGG/AAC fallbacks only if needed

**Quality**
- [ ] Lighthouse 90+ for Performance, Accessibility and Best Practices
- [ ] Keyboard-only navigation works
- [ ] Works with `prefers-reduced-motion` and in both color schemes

---

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Autoplay blocked by browsers | Start playback only after a user click |
| Broken paths on GitHub Pages | Deploy first; use relative paths; test on the live URL |
| Repo bloated by audio | Keep only small demos in the repo; use local files or external hosting |
| External host blocks CORS or range requests | Test seeking before adopting a host; keep a fallback |
| Copyright issues | Use only licensed or original audio; local files never leave the device |
| IndexedDB quota or private-mode limits | Catch errors, warn the user, fall back to session-only tracks |
| Safari / iOS audio quirks | Use MP3/AAC; test early on real devices |
| Actions workflow loops or conflicts | Limit the trigger to `assets/audio/**`; commit with `[skip ci]` |
| Service worker serves stale files | Version the cache name; clear old caches on activate |

---

## 14. Future Enhancements

- Multiple named playlists
- Visualizer and equalizer using the Web Audio API
- Offline audio caching with range-request handling
- Synced lyrics (`.lrc` files)
- Playback speed control and sleep timer

---

## 15. Definition of Done

- The player works on desktop and mobile at the live GitHub Pages URL.
- All MVP and "Should have" features are implemented and tested.
- Users can add their own files and find them again after a reload.
- Adding a repo track requires only dropping the file in `assets/audio/` and pushing.
- The README includes a description, live link, "add a song" instructions and credits.
- The code is modular, uses the shared state store, and has no console errors.
