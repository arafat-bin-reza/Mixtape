# Plan: External Links as Audio, and Cloudinary Storage for Uploads

This plan has four parts. Parts A-C share one playback path; Part D observes it:

- **Part A** (sections 1-10): paste a link to a video or audio hosted elsewhere and play it as an audio track.
- **Part B** (sections 11-20): let a listener upload media to Cloudinary so it is stored in the cloud rather than only in their browser, and play it back through the same direct-URL path as Part A.
- **Part C** (sections 21-30): paste a Spotify track or episode link and play it through Spotify's official embedded player, as a fourth provider engine beside YouTube, SoundCloud and Vimeo.
- **Part D** (sections 31-41): an audit log of who uses the app (IP address, device), which tracks they add and listen to, and the links and details of those tracks. Not yet implemented; needs a small server-side collector because a static site cannot see IP addresses or store shared data.

Part C adds `js/engines/spotify.js` and parser rules; it depends on Part A's engine layer and Add-link dialog, both already built.

Uploads to Cloudinary produce ordinary `https://res.cloudinary.com/...` URLs, so Part B needs no new playback engine. It reuses Part A's `url-tracks` module and the `html-audio` engine. Build Part A steps 0-3 first; Part B depends on them.

---

# Part A: Play External Audio/Video URLs as Audio

## 1. Goal

Let a listener paste a link to a video or audio hosted elsewhere (YouTube, SoundCloud, Vimeo, Facebook, Instagram, TikTok, a direct `.mp3`/`.mp4` link, etc.) and have it appear in the Mixtape playlist as an audio track, with the same controls as every other track: play/pause, seek, next/previous, shuffle, repeat, volume, keyboard shortcuts, and Media Session integration.

## 2. Constraints That Shape the Design

Mixtape is a static site on GitHub Pages with no backend. That rules out some approaches and forces honesty about others.

| Constraint | Consequence |
|---|---|
| No server. Everything runs in the browser. | We cannot run `yt-dlp` or similar extractors. Audio must come from a URL the browser can fetch directly or from a provider's official embeddable player. |
| Browser same-origin policy. | A plain `<audio src>` can play a cross-origin file without CORS, but seeking needs HTTP range support, and reading metadata via `fetch` needs CORS headers. |
| Platform Terms of Service. | YouTube, Facebook, Instagram, and TikTok do not permit extracting the audio stream. YouTube's API terms also require the player to remain visible (minimum 200x200 px) and not be hidden or audio-only. SoundCloud and Vimeo offer audio-friendly official players. |
| Current `player.js` wraps a single `<audio>` element. | External providers need a different playback engine. The player layer must become pluggable. |
| Social links are often "share" URLs (shortened, with tracking params, mobile hosts). | We need a URL normaliser that recognises each provider's link shapes and extracts a stable id. |

**Decision:** support external URLs through three tiers, in order of implementation:

1. **Direct media URLs** (any `https://` link ending in a playable audio/video file or served with an audio/video content type). Played natively by `<audio>`. Video files play audio-only because `<audio>` discards the video track.
2. **Official embedded players** for providers that expose a JavaScript player API: SoundCloud (Widget API), YouTube (IFrame Player API, with the player shown in a compact but visible "now playing" area to comply with its terms), Vimeo (Player SDK). Audio is played by the provider's own player; Mixtape drives it through a common adapter interface.
3. **Optional self-hosted resolver** (out of scope for GitHub Pages). A small server the owner can deploy that turns a social link into a direct stream URL. This tier is documented as an extension point, not built by default, because of ToS and legal exposure for most platforms. Facebook, Instagram, and TikTok links will only ever work through this tier.

## 3. User Experience

- A new **Add link** button next to **Add files** in the playlist header. Pasting a URL anywhere on the page (Ctrl/Cmd+V outside an input) also opens the same dialog pre-filled.
- The dialog shows the URL, detects the provider, fetches title/artist/artwork/duration where possible (oEmbed), lets the user edit title and artist, and has **Add** / **Cancel**.
- Unsupported links show a clear message: "Mixtape can play direct audio/video links, SoundCloud, YouTube and Vimeo. Facebook, Instagram and TikTok links are not supported."
- URL tracks appear in the playlist with a small provider badge (icon or text such as "YouTube") and a remove button, like local tracks.
- For YouTube, the cover area of the Now Playing panel is replaced by the compact embedded player while a YouTube track is current. For SoundCloud and Vimeo the widget can be rendered off-screen-but-present or in the same slot; the cover art from oEmbed is shown as usual.
- Playback failures (private video, region block, removed track, offline) mark the track as failed and skip it, reusing the existing `state.failed` flow.
- URL tracks persist across reloads (they are tiny metadata records, so `localStorage` or IndexedDB both work; IndexedDB keeps them beside local tracks).

## 4. Architecture Changes

### 4.1 Track model

Add a third `source` and provider fields:

```json
{
  "id": "url-yt-dQw4w9WgXcQ",
  "title": "...",
  "artist": "...",
  "src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "cover": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "duration": 213,
  "source": "url",
  "provider": "youtube",
  "externalId": "dQw4w9WgXcQ"
}
```

`provider` is one of `direct | soundcloud | youtube | vimeo`. Repo and local tracks get `provider: "direct"` implicitly (undefined is treated as direct), so nothing existing changes.

Ids are deterministic (`url-<provider>-<externalId>`, or a hash of the normalised URL for `direct`) so adding the same link twice is a no-op.

### 4.2 Playback engine abstraction

Refactor `js/player.js` into a thin facade over interchangeable **engines** that all implement the same interface:

```js
// js/engines/engine.js (interface, documented in JSDoc)
{
  canPlay(track) -> boolean,
  load(track, { autoplay }) -> Promise<void>,
  play(), pause(), seek(seconds), setVolume(0..1), setMuted(bool),
  currentTime() -> number, duration() -> number,
  destroy(),
  on(event, fn)   // events: timeupdate, loadedmetadata, play, pause, ended, error
}
```

Engines:

| File | Engine | Notes |
|---|---|---|
| `js/engines/html-audio.js` | Existing `<audio>` logic moved here unchanged. | Handles repo, local, and direct URL tracks. |
| `js/engines/soundcloud.js` | SoundCloud Widget API (`https://w.soundcloud.com/player/api.js`). | Hidden iframe is allowed by SoundCloud's embed terms. Supports play/pause/seek/volume/events. |
| `js/engines/youtube.js` | YouTube IFrame Player API (`https://www.youtube.com/iframe_api`). | Player rendered visibly in the cover slot (min 200x200). Poll `getCurrentTime()` every 250 ms for `timeupdate` since the API has no such event. |
| `js/engines/vimeo.js` | Vimeo Player SDK (`https://player.vimeo.com/api/player.js`). | Supports hidden/background playback; events map directly. |

`player.js` keeps its public API (`init`, `play`, `pause`, `toggle`, `seek`, `seekBy`, `setVolume`, `toggleMute`) so `ui.js`, `app.js`, and `media-session.js` do not change. Internally, `sync(state)` picks the engine via `canPlay(track)` when the current track id changes, destroys the previous engine if it differs, and re-attaches the event listeners that write into state.

Provider SDK scripts are loaded lazily the first time an engine is needed, so the page stays dependency-free until a social link is added.

### 4.3 URL handling

New module `js/url-tracks.js`, parallel to `local-files.js`:

- `parse(url)`: normalise (trim, add `https://`, strip tracking params like `si`, `utm_*`, `feature`), detect provider from host patterns, extract `externalId`. Returns `{ provider, externalId, canonicalUrl }` or `null` for unsupported links.
  - YouTube: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `m.youtube.com`, `music.youtube.com`.
  - SoundCloud: `soundcloud.com/<user>/<track>`, `on.soundcloud.com/<short>` (short links need a resolve step; treat as unsupported in the first pass and note it).
  - Vimeo: `vimeo.com/<id>`, `player.vimeo.com/video/<id>`.
  - Direct: any other URL whose path ends in a known media extension (`mp3 m4a aac ogg opus wav flac mp4 webm m4v`). URLs without an extension are probed with a throwaway `<audio>` (reuse the existing `probe` pattern from `local-files.js`, with an 8 s timeout).
- `describe(parsed)`: fetch metadata.
  - Use each provider's oEmbed endpoint (`https://www.youtube.com/oembed`, `https://soundcloud.com/oembed`, `https://vimeo.com/api/oembed.json`) for title, author, and thumbnail. Verify in the spike which endpoints send CORS headers; fall back to `https://noembed.com/embed?url=` which does, and finally to a plain "Untitled / <provider>" record the user can edit.
  - Duration comes from the engine on first load if oEmbed does not supply it.
- `add(url)`, `loadAll()`, `remove(id)`: persistence in a new IndexedDB store `url-tracks` (bump the DB version to 2 in `local-files.js`'s `open()` and create the store in `onupgradeneeded`). Records hold only metadata, no blobs.

`app.js` loads repo, local, and URL tracks together: `Promise.all([loadRepoTracks(), local.loadAll(), urlTracks.loadAll()])`.

### 4.4 UI

- `index.html`: add the **Add link** button, a `<dialog id="link-dialog">` with URL input, detected-provider line, editable title/artist fields, preview thumbnail, status/error line, and Add/Cancel buttons. Add a `<div id="embed-slot">` inside `.cover` for provider players.
- `ui.js`:
  - Open the dialog from the button and from a `paste` listener on `window` (only when the pasted text parses as a URL and focus is not in an input).
  - Debounced parse + describe while the user types; disable Add until parse succeeds.
  - Provider badge in `renderList` rows; reuse the existing remove button path for `source === "url"`.
  - In `renderTrack`, toggle `#embed-slot` visibility based on whether the current track's engine renders a visible player.
- `css/style.css`: styles for the dialog, badge, and embed slot (keep the slot square, matching `.cover`).

### 4.5 Media Session

No change needed. The existing subscriber already reads `title`, `artist`, `cover`, `duration`, and `currentTime` from state, which the engines keep updated.

### 4.6 Content Security Policy (if one is added later)

Provider SDKs and iframes require `script-src` and `frame-src` entries for `youtube.com`, `w.soundcloud.com`, and `player.vimeo.com`. Document this in CLAUDE.md.

## 5. Implementation Steps

| Step | Work | Files | Est. |
|---|---|---|---|
| 0 | **Spike (half day).** Confirm: which oEmbed endpoints are CORS-readable from a GitHub Pages origin; that the YouTube IFrame API plays reliably in a 200x200 player; that the SoundCloud widget works when visually hidden; that a direct cross-origin `.mp4` plays audio in `<audio>` and seeks with range support. Record findings at the bottom of this file. | scratch only | 0.5 d |
| 1 | Extract the current `<audio>` code into `js/engines/html-audio.js` behind the engine interface. `player.js` becomes the facade with a single engine. No behaviour change. Run smoke tests. | `player.js`, `engines/html-audio.js` | 0.5 d |
| 2 | Add `js/url-tracks.js` with `parse`, `describe` (direct + oEmbed), IndexedDB store, and deterministic ids. Unit-test `parse` in Node (it has no DOM dependency). | `url-tracks.js`, `local-files.js` (DB version), `tests/unit/url-parse.test.js` | 1 d |
| 3 | Add the **Add link** dialog and paste handling in `ui.js` and `index.html`; wire `app.js` to load URL tracks; provider badge and remove button. Direct URLs now play end to end. | `index.html`, `ui.js`, `app.js`, `style.css` | 1 d |
| 4 | SoundCloud engine with lazy SDK load. Map widget events to the engine interface. | `engines/soundcloud.js`, `player.js` | 1 d |
| 5 | YouTube engine with visible compact player in the cover slot, 250 ms time polling, error-code mapping (2, 5, 100, 101, 150 all map to "can't be played"). | `engines/youtube.js`, `ui.js`, `style.css` | 1.5 d |
| 6 | Vimeo engine. | `engines/vimeo.js` | 0.5 d |
| 7 | Failure handling: engine `error` events feed `state.failed` through the existing `onError` path; offline detection shows a toast instead of marking the track failed. | `app.js`, `player.js` | 0.5 d |
| 8 | Playwright tests: add a direct URL served by the local test server (`tests/fixtures/tone.mp3`), add an unsupported link and assert the error, add a YouTube link with `window.YT` stubbed via `page.addInitScript` and assert the playlist row and badge. | `tests/` | 1 d |
| 9 | Docs: README section "Add a link", CLAUDE.md engine notes, update `technical.md` stack table. | docs | 0.25 d |

Total: roughly 7.5 developer-days, with Steps 0-3 delivering usable value on their own (direct media links).

## 6. Testing Strategy

- **Unit (Node):** `url-tracks.parse` against a table of real-world link shapes for each provider, including mobile hosts, `shorts`, `youtu.be`, tracking parameters, and malformed input. `playlist.js` behaviour with mixed sources.
- **Browser (Playwright):**
  - Direct URL track added, plays, seeks, appears in Media Session metadata (`page.evaluate(() => navigator.mediaSession.metadata.title)`).
  - Unsupported URL shows the error and does not add a row.
  - Duplicate URL does not add a second row.
  - Provider engines with stubbed SDK globals; assert engine method calls (play/pause/seek) and that errors mark the row `.bad`.
  - Reload preserves URL tracks.
- **Manual checklist** (cannot be automated reliably because they hit third-party services): one real link per provider in Chrome, Firefox, Safari, and Android Chrome; keyboard shortcuts while a provider track is current; lock-screen controls on a phone.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| YouTube terms forbid audio-only or hidden players. | Keep the player visible in the cover slot at 200x200 or larger. Do not add a "hide video" option for YouTube. State this in the UI copy. |
| Provider SDK or oEmbed endpoints change or go down. | Engines fail gracefully to `state.failed`; oEmbed falls back to a user-editable "Untitled" record. SDK URLs are pinned in one constants file. |
| Users expect Facebook, Instagram, TikTok, Spotify to work. | Clear unsupported message naming what is supported. Spotify could be added later via its embed (30 s previews only without login), which is likely not worth it. |
| Autoplay policies block provider players until a user gesture. | All playback starts from a click or key press already; engines surface `NotAllowedError` the same way `html-audio` does today. |
| Mixed engines break `next()` timing (one engine still firing events while another loads). | `player.js` detaches listeners and calls `destroy()` on the old engine before loading the new one; each engine ignores events after `destroy()`. |
| Direct URLs without range support cannot seek. | Detect `duration === Infinity` or a failed seek and disable the seek slider for that track with a tooltip. |
| Third-party scripts increase page weight and privacy exposure. | Lazy-load SDKs only after the first provider track is added. Mention third-party loading in the README privacy note. |

## 8. Out of Scope (This Iteration)

- Server-side extraction of audio from Facebook, Instagram, TikTok, or YouTube. If the owner later wants this, implement Tier 3 as a separate repo exposing `GET /resolve?url=` that returns `{ src, title, artist, cover, duration }`, and add a `resolver` engine that calls it. Mixtape would read the resolver base URL from a `config.json`. Legal review is required before deploying such a service.
- Downloading or caching external audio for offline use.
- Playlists imported from provider playlists or channels (one link = one track in this iteration).
- Short-link resolution (`on.soundcloud.com`, `youtu.be` is fine since it carries the id).

## 9. Acceptance Criteria

1. Pasting a direct `.mp3` or `.mp4` link adds a playable track that survives reload and works with every existing control and shortcut.
2. Pasting a SoundCloud, YouTube, or Vimeo link adds a track with correct title, artist, and artwork, and it plays, pauses, seeks, and advances to the next track on end.
3. Pasting an unsupported or invalid link shows an explanatory message and adds nothing.
4. Adding the same link twice produces one row.
5. A failing external track is skipped with the existing "can't be played" message.
6. Existing smoke tests pass, and new unit and browser tests cover the parser and at least one engine.
7. No provider script is loaded until a provider track exists in the playlist.

## 10. Spike Findings (2026-11-08)

**Part A (links)**

| Check | Result |
|---|---|
| YouTube oEmbed (`youtube.com/oembed`) CORS | Allowed: echoes the request origin in `Access-Control-Allow-Origin`. |
| SoundCloud oEmbed (`soundcloud.com/oembed`) CORS | Allowed: `*`. |
| Vimeo oEmbed (`vimeo.com/api/oembed.json`) CORS | Allowed: `*`. |
| noembed.com fallback CORS | Allowed: `*`. Kept as the fallback only. |
| Dev server | No Python on the dev machine; replaced by `scripts/serve.mjs` (Node, range requests). |

Not verified live (needs a real browser session against the third-party players): YouTube IFrame API in a 200x200+ slot, SoundCloud widget while off-screen, Vimeo background playback. Engines are implemented and covered by a stubbed YouTube browser test; a manual pass per provider is still owed (section 6, manual checklist).

**Part B (Cloudinary, account `tivkdskh`, preset `mixtape-unsigned`)**

| Check | Result |
|---|---|
| Unsigned upload of a 2 s WAV with `folder=mixtape`, `tags`, `context` | HTTP 200. `public_id: mixtape/ybpr2mpllwj5ww1ebwxx`, `asset_folder: mixtape`, `is_audio: true`, `duration: 2`, context and tags stored. |
| MP3 delivery (`/video/upload/<public_id>.mp3`) | HTTP 200, `audio/mpeg`, transcoded on first request. `q_auto` variant also 200. |
| Range requests on delivery URL | HTTP 206 with `Accept-Ranges: bytes`; seeking works. |
| CORS on delivery URL | `Access-Control-Allow-Origin: *`. |
| Waveform cover (`fl_waveform,...,w_600,h_600/<public_id>.png`) | HTTP 200, `image/png`. |
| Resource list (`/video/list/mixtape-public.json`) | HTTP 401: "Resource list" is disabled in the console. The app treats this as an empty shared playlist. Enable it only if the public playlist is wanted. |
| Eager MP3 rendition | Not configured on the preset; the client falls back to the on-demand `.mp3` URL. Add `f_mp3` eager transformation on the preset to remove first-play transcoding delay. |

The spike upload is tagged `spike` and can be deleted from the Media Library.

---

# Part B: Cloudinary Storage for Uploaded Media

## 11. Goal

When a listener uploads an audio or video file, store it on Cloudinary (`https://console.cloudinary.com/`) instead of, or in addition to, the browser's IndexedDB. The uploaded file becomes a normal playlist track with a permanent `https://res.cloudinary.com/...` URL that:

- plays as audio even when the upload was a video (Cloudinary transcodes on delivery);
- survives browser data being cleared and can be opened from another device by URL;
- can optionally be shared with everyone visiting the site via a Cloudinary tag-based resource list, giving Mixtape a community playlist with no backend.

## 12. Why Cloudinary Fits a Static Site

| Need | Cloudinary feature | Notes |
|---|---|---|
| Upload from the browser with no server. | **Unsigned upload presets** via `POST https://api.cloudinary.com/v1_1/<cloud_name>/video/upload`. | Audio files use `resource_type: video` in Cloudinary. The request carries only the public cloud name and preset name; no secret is needed. |
| Play a video upload as audio. | **Format transformation on delivery**: request `.../video/upload/<public_id>.mp3` (or `f_mp3`). | Cloudinary extracts and transcodes the audio stream. `q_auto` and bitrate options (`br_128k`) keep bandwidth down. |
| Seeking in the player. | Cloudinary's CDN supports HTTP range requests. | Required for the seek slider; already true for its delivery URLs. |
| Title, artist, duration, artwork. | Upload response returns `duration`, `format`, `bytes`, `public_id`, `secure_url`. **Contextual metadata** (`context=caption=<title>|alt=<artist>`) and **tags** can be set on unsigned uploads. `fl_waveform` generates a waveform PNG as cover art. | No separate metadata store needed. |
| Shared playlist without a database. | **Client-side resource list by tag**: `https://res.cloudinary.com/<cloud_name>/video/list/<tag>.json` returns every resource carrying that tag, including `context` and `duration`. | Must be enabled in Console > Settings > Security ("Resource list"). Cached by CDN for about a minute. |
| Limits and abuse control without a backend. | Preset options: allowed formats, max file size, folder, auto-tagging, moderation add-on, "overwrite: false", "unique filename". | See section 16 for what unsigned presets cannot protect against. |
| Cost. | Free plan: about 25 credits/month, where 1 credit = 1 GB storage, 1 GB bandwidth, or 1,000 transformations. Video/audio uploads are limited to roughly 100 MB per file on the free plan. | Verify current limits in the console; they change. |

## 13. User Experience

**Decision (owner, 2026-11-08): all uploaded media is stored in the Cloudinary account `tivkdskh`.** Browser-only storage is no longer the default; it remains only as a fallback.

- The existing **Add files** button and the drag-and-drop zone now upload to Cloudinary. There is no separate "Upload to cloud" button.
- Selecting or dropping files opens a dialog that:
  - lists the selected files with size and a detected title/artist (reuse `describe()` from `local-files.js`), both editable;
  - shows a plain consent line: "Files are uploaded to Mixtape's cloud storage and become playable by URL. Do not upload content you do not have the right to share.";
  - has an optional checkbox **Add to the public playlist** (only shown if the owner has enabled the shared list, see section 15);
  - shows per-file progress bars with cancel, and a final success/failure summary.
- Uploaded tracks appear with a cloud badge, play immediately, and persist in the listener's browser as URL tracks (Part A's `url-tracks` store), so they are still there after reload and can be re-added on another device by URL.
- Removing a cloud track from the playlist removes it from the listener's view only. Deleting the file from Cloudinary is an owner action done in the Cloudinary console (unsigned clients cannot delete; see section 16).
- **Fallback.** If the upload fails because the device is offline or Cloudinary returns an error, the dialog offers "Keep on this device only", which stores the file in IndexedDB exactly as today. Such tracks carry the existing local badge and the toast explains they will not sync. If `cloudinary.cloudName` is empty in config, Add files silently uses the local path, so the app still works in a fork with no Cloudinary account.
- **Existing local tracks** already stored in IndexedDB by earlier visitors are kept and still play. A one-time "Move to cloud" action on each local row uploads it and replaces the record; this is optional and can be deferred.
- The README and the page's meta description currently say "nothing is uploaded". Both must be rewritten to say that added files are uploaded to Mixtape's cloud storage, with a takedown contact.

## 14. Architecture

### 14.1 Configuration

New file `config.json` at the repo root, fetched at startup by `app.js`:

```json
{
  "cloudinary": {
    "cloudName": "tivkdskh",
    "uploadPreset": "mixtape-unsigned",
    "folder": "mixtape",
    "sharedTag": "mixtape-public",
    "maxBytes": 104857600,
    "allowedFormats": ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "mp4", "webm", "mov"]
  }
}
```

Only public values live here. The Cloudinary API key and secret are never used by the site and must never be committed.

### 14.2 New module `js/cloud-upload.js`

- `configure(cfg)`: stores config; `isEnabled()` returns whether `cloudName` is set.
- `upload(file, { title, artist, shared, onProgress })`:
  - Validates extension and size against config before sending.
  - Builds `FormData` with `file`, `upload_preset`, `folder`, `context` (`caption=<title>|alt=<artist>`), and `tags` (`mixtape` plus `sharedTag` when the user opted in).
  - Sends with `XMLHttpRequest` (needed for upload progress events; `fetch` has none) to `https://api.cloudinary.com/v1_1/<cloudName>/video/upload`.
  - Returns a track object built from the response:

    ```js
    {
      id: `cloud-${res.public_id}`,
      title, artist,
      src: `https://res.cloudinary.com/${cloudName}/video/upload/q_auto/${res.public_id}.mp3`,
      cover: `https://res.cloudinary.com/${cloudName}/video/upload/fl_waveform,co_rgb:8aa0ff,b_rgb:171a24,w_600,h_600/${res.public_id}.png`,
      duration: Math.round(res.duration),
      source: "url", provider: "cloudinary",
      publicId: res.public_id, bytes: res.bytes, original: res.secure_url
    }
    ```

  - Persists the track through `urlTracks.put()` so it reloads with the rest.
- `loadShared()`: fetches `https://res.cloudinary.com/<cloudName>/video/list/<sharedTag>.json`, maps each resource to a track using the same URL scheme, and returns `[]` on any failure (list disabled, network down). Called from `app.js` alongside the other loaders; shared tracks get `source: "shared"` so they are read-only in the UI (no remove button).

### 14.3 Changes to existing modules

| File | Change |
|---|---|
| `js/app.js` | Fetch `config.json`, call `cloudUpload.configure`, add `cloudUpload.loadShared()` to the startup `Promise.all`. |
| `js/url-tracks.js` (Part A) | Export `put(track)` so cloud uploads can be stored as URL tracks. Treat `provider: "cloudinary"` as direct playback. |
| `js/ui.js` | Upload dialog, progress rendering, cloud/shared badges, drop-zone choice between local and cloud. |
| `index.html` | Upload to cloud button, `<dialog id="upload-dialog">`, progress list markup. |
| `css/style.css` | Dialog, progress bar, badges. |
| `js/engines/html-audio.js` | No change. Cloudinary URLs are direct media URLs. |

### 14.4 Why not the Cloudinary Upload Widget

Cloudinary ships a hosted Upload Widget (`upload-widget.cloudinary.com/global/all.js`) that handles drag-and-drop, progress, and even remote URL fetching. It would shorten steps 2-3 below, but it adds a 200 KB+ third-party script, its own UI that does not match the app theme, and it conflicts with the existing drop-zone. Recommendation: use the plain REST upload. Revisit the widget only if remote-URL import (section 17) becomes a priority.

## 15. Cloudinary Console Setup (Owner Tasks)

These are one-time steps in `https://console.cloudinary.com/`.

### 15.1 Current state of the preset (from the console screenshot, 2026-11-08)

| Setting | Value | Effect on the plan |
|---|---|---|
| Name / Mode | `mixtape-unsigned` / **Unsigned** | Confirmed. Uploads from the static site work. |
| Type | `upload` | Public delivery URLs, no signed URLs needed for playback. |
| Overwrite | false | Good. A collision can never replace an existing track. |
| Use filename | false | Cloudinary assigns a random `public_id`. Good for privacy; the app must keep the title in `context`, not derive it from the id. |
| Unique filename | false | Irrelevant because "Use filename" is off. |
| Use filename as display name | true | The Media Library shows the original filename, which helps the owner moderate. |
| Use asset folder as public id prefix | false | `public_id` has no folder prefix. Delivery URL is `https://res.cloudinary.com/tivkdskh/video/upload/<public_id>.mp3`. |
| Default preset | not set | Fine. The app passes `upload_preset=mixtape-unsigned` explicitly. |
| Folder, allowed formats, max file size, tags, eager transformations | not visible in the list, assumed unset | See 15.2. The client sends what it can; the rest should be set in the console for server-side enforcement. |

### 15.2 Recommended additions to the preset (open the preset's edit page)

1. **Upload manipulations / Storage:** Asset folder `mixtape` so uploads do not land in the account root. Until this is set, the app passes `folder=mixtape` in the request, which unsigned uploads permit.
2. **Upload control:** Allowed formats `mp3,m4a,aac,ogg,opus,wav,flac,mp4,webm,mov`. Max file size 100 MB (or lower to control credits). These are enforced server-side; client-side validation in `cloud-upload.js` is only a convenience and can be bypassed.
3. **Tags:** `mixtape` auto-applied, so every upload from the app is identifiable in the Media Library. The app also sends `tags=mixtape` in the request as a belt-and-braces measure.
4. **Eager transformations:** `f_mp3,q_auto` (asynchronous off) so the audio rendition exists when the upload response returns. Without it, the first play of a video upload waits for an on-the-fly transcode.
5. **Optional:** enable a moderation add-on (for example AWS Rekognition for video) to hold uploads for review before they become deliverable, and turn on `return_delete_token` for the 10-minute undo.

None of these additions block step B0. The spike runs against the preset as it is now; items 1-4 should be set before the feature ships.
2. **Settings > Security.**
   - Enable **Resource list** (needed for the shared playlist JSON). Leave disabled if the shared playlist is not wanted.
   - Restricted media types: leave `video` unrestricted so unsigned delivery works.
   - Allowed fetch domains: not needed for v1.
3. **Settings > Account:** note the **cloud name**. Put it and the preset name in `config.json`.
4. **Billing/Usage dashboard:** set a usage alert at, for example, 80 percent of monthly credits.

Nothing else is required to connect. The API key and secret are only needed for Part B tier-2 work (signed uploads and deletion through a serverless function), described in section 17.

## 16. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **Privacy promise.** README and page copy say "nothing is uploaded", but uploads now go to Cloudinary by default. | Rewrite README, `index.html` meta description, and the empty-playlist hint before release. Show the consent line in the upload dialog every time. Keep the offline/failure fallback so a user can still choose device-only storage. |
| **Unsigned preset abuse.** Anyone who reads `config.json` can upload to the account with the preset, burning credits or storing unwanted content. | Preset limits (formats, size, folder). Usage alerts. Moderation add-on. Rotate or disable the preset from the console if abused. Long term, move to signed uploads through a tiny serverless function (section 17), which lets the owner add rate limits or a shared passphrase. |
| **Cannot delete from the browser.** Unsigned clients have no delete permission. | Owner deletes via the Cloudinary Media Library. Optionally enable `return_delete_token` on the preset, which allows the uploader to undo within 10 minutes; expose this as an "Undo upload" link in the success toast. |
| **Copyright.** Users may upload content they do not own. | Consent text, a takedown contact in the README, moderation add-on, and the owner's ability to remove resources. The shared playlist should stay opt-in and owner-reviewed (for example, require the owner to add the `mixtape-public` tag manually in the console rather than letting uploaders set it). |
| **Credits exhaustion.** Bandwidth counts against the free plan every time a track is streamed. | Deliver with `q_auto` or a fixed `br_96k`/`br_128k` so a 5-minute track is about 4-5 MB. Monitor usage. If the public playlist becomes popular, either upgrade the plan or cap the shared list. |
| **Resource list caching.** The tag list JSON is CDN-cached for about 60 seconds. | Acceptable; a newly uploaded shared track appears for its uploader immediately (it is added locally) and for others within a minute. |
| **Large uploads on mobile.** 100 MB uploads over cellular are slow and can fail. | Show progress, allow cancel (`xhr.abort()`), and warn above 25 MB. Cloudinary supports chunked uploads (`X-Unique-Upload-Id` header, 6 MB+ chunks) for files over 100 MB if ever needed. |
| **Transcoding latency.** The first request for `<public_id>.mp3` of a video upload triggers an on-the-fly transcode that can take several seconds for long files. | Use `eager` transformations on the preset (`f_mp3,q_auto`) so the audio rendition is generated at upload time, and play the `eager[0].secure_url` from the response. |

## 17. Follow-up Options (Not in This Iteration)

- **Signed uploads and deletion.** A Cloudflare Worker or Netlify Function holding the API secret: `POST /sign` returns a signature for the upload, `DELETE /track/:publicId` removes it. Enables per-user delete, rate limiting, and a private-upload passphrase. This is the only piece that needs the Cloudinary API key and secret.
- **Remote URL import.** Cloudinary can ingest a public media URL server-side (`file=<https URL>` in the upload call) so a direct `.mp4` link from Part A can be copied into Cloudinary and transcoded to MP3 once, instead of streamed from the original host each time. Does not work for YouTube or social platforms, which block fetching.
- **Owner-curated repo tracks on Cloudinary.** Move `assets/audio/*.wav` to Cloudinary and point `data/tracks.json` at the MP3 delivery URLs. This removes the 74 MB of WAV files from the repository, which `technical.md` lists as debt. The generator script can be extended to upload with the Node SDK (signed, using a local `.env`, never committed).

## 18. Implementation Steps

| Step | Work | Files | Est. |
|---|---|---|---|
| B0 | Owner completes section 15 and shares the cloud name and preset name. Spike: upload a 1-minute MP4 with the preset from a local page, confirm the `.mp3` delivery URL plays and seeks, confirm the resource list JSON is readable from the GitHub Pages origin, record waveform cover output. | scratch only | 0.5 d |
| B1 | `config.json`, `cloud-upload.js` with `configure`, `upload` (XHR, progress, validation), and track mapping. Node unit tests for validation and track mapping using a recorded upload response. | `config.json`, `cloud-upload.js`, `tests/unit/cloud-upload.test.js` | 1 d |
| B2 | Route Add files and drag-and-drop through the upload dialog: progress UI, cancel, consent copy, badges, "Keep on this device only" fallback, silent local path when unconfigured. | `index.html`, `ui.js`, `style.css` | 1.25 d |
| B3 | Persist uploaded tracks via `url-tracks.put`; verify reload, remove, Media Session metadata, and waveform cover. | `url-tracks.js`, `app.js` | 0.5 d |
| B4 | Shared playlist: `loadShared()`, `source: "shared"` rendering, read-only rows, opt-in checkbox (only if the owner chooses to let uploaders tag). | `cloud-upload.js`, `app.js`, `ui.js` | 0.5 d |
| B5 | Eager MP3 rendition on the preset; use `eager[0].secure_url` when present. Optional 10-minute undo via delete token. | `cloud-upload.js`, console settings | 0.5 d |
| B6 | Playwright tests with the upload endpoint mocked by `page.route()`: successful upload adds a row and plays a fixture served locally; failed upload shows an error; oversize file is rejected before sending; disabled config hides the button. | `tests/` | 1 d |
| B7 | README privacy and upload sections, takedown contact, CLAUDE.md config notes, `technical.md` stack update. | docs | 0.25 d |

Total: about 5 developer-days, on top of Part A steps 0-3.

## 19. Acceptance Criteria

1. With `config.json` populated, a user can upload an MP3 or MP4, see progress, and have it play as audio immediately and after reload, with seek working.
2. A video upload plays audio only, delivered as MP3 from Cloudinary.
3. Files over the configured size or with a disallowed extension are rejected client-side with a clear message and no network request.
4. With `cloudName` empty, Add files stores to the browser only and the app behaves as it does today.
5. When an upload fails or the device is offline, the user can keep the file on the device only, and it plays and persists as a local track.
6. If the resource list is enabled and a resource carries the shared tag, it appears for every visitor as a read-only track.
7. No Cloudinary API key or secret exists anywhere in the repository or in network requests from the page.

## 20. What the Owner Needs to Provide

| Item | Where to find it | Safe to commit? |
|---|---|---|
| Cloud name | **Provided: `tivkdskh`.** Upload endpoint: `https://api.cloudinary.com/v1_1/tivkdskh/video/upload`. Delivery base: `https://res.cloudinary.com/tivkdskh/video/upload/`. Shared list: `https://res.cloudinary.com/tivkdskh/video/list/mixtape-public.json`. | Yes |
| Unsigned upload preset name | **Confirmed: `mixtape-unsigned`** (owner, 2026-11-08). | Yes |
| Decision on the shared playlist | Enable "Resource list" or not | n/a |
| API key and secret | Console > Settings > API keys | **No.** Only needed for section 17 work, kept in a serverless function's environment or a local `.env`. |

---

# Part C: Spotify Integration

## 21. Goal

Let a listener paste a Spotify track or podcast-episode link (or a `spotify:` URI) and have it appear in the playlist as a normal row: provider badge, title, artwork, remove button, persistence across reloads, and the same transport controls as every other track. Playback goes through Spotify's official **Embed iFrame API**, driven by a new `js/engines/spotify.js` that implements the existing engine interface. This revisits the note in section 7 ("Spotify could be added later via its embed") now that the engine layer, the Add-link dialog and the YouTube visible-player pattern exist; the incremental cost is small.

## 22. Constraints That Shape the Design

Spotify offers three browser-side integration routes. Only one fits a static GitHub Pages site with no owner-run backend.

| Route | What it gives | Why it does or does not fit Mixtape |
|---|---|---|
| **Embed iFrame API** (`https://open.spotify.com/embed/iframe-api/v1`) | A visible Spotify player in an iframe with a JavaScript controller: `loadEntity/loadUri`, `play`, `pause`, `resume`, `togglePlay`, `seek(seconds)`, `destroy`, and events `ready`, `playback_started`, `playback_update` (`position`, `duration` in ms, `isPaused`, `isBuffering`, `playingURI`). No authentication, no app registration, no quota. Plays a **30-second preview** for visitors who are not logged in to Spotify in that browser, and the **full track** for visitors who are logged in (subject to Spotify's own rules). | **Chosen.** Same shape as the YouTube engine: a visible player in the cover slot plus event-driven time updates. Requires the iframe to be at least 280 px wide at its rendered size and to carry `allow="encrypted-media"` for full-length playback. No volume API. |
| **Web Playback SDK** | Full-length, audio-only playback inside the page, with volume control, through a Spotify Connect device created in the browser. | Not feasible now. Requires a Spotify **Premium** listener, OAuth (PKCE is possible without a secret), a registered Spotify app whose redirect URI is the GitHub Pages URL, and Spotify's 2025 developer-platform rules: apps stay in **Development Mode** with a per-app cap of allow-listed users (reported as 25, reduced to 5 during 2025; confirm in the dashboard), and leaving it needs a registered business with 250,000 monthly active users. The SDK also must not be used in commercial projects without Spotify's written approval. Documented as a possible later tier only. |
| **Web API** for metadata (artist, duration, album) | Clean metadata for the row. | Needs a token: either Client Credentials (secret, so a serverless function, like section 17) or a user login (Development Mode cap). Deferred. The oEmbed endpoint gives title and artwork without any token, which is enough for the row. |

Other constraints:

- **oEmbed has no artist field.** `https://open.spotify.com/oembed?url=...` returns `title`, `thumbnail_url` (300x300), `iframe_url`, `provider_name`. CORS is `*` (verified, section 30). The dialog will default the artist to "Spotify" and let the user edit it, exactly as it does for direct links.
- **No `ended` event.** The controller only emits `playback_update`. Track end has to be inferred from the update stream (section 24.3).
- **No volume or mute API.** Mixtape's volume slider cannot affect the embed. The engine treats `setVolume`/`setMuted` as no-ops and the UI shows a short hint while a Spotify track is current.
- **Player must stay visible.** Spotify's embed terms, like YouTube's, forbid hiding or covering the player. It renders in the same `.cover` slot the YouTube engine uses, via `data-embed="spotify"`.
- **Autoplay.** `play()` may be blocked until a user gesture (Safari especially). All Mixtape playback already starts from a click or key press; the embed's own Play button is also visible as a fallback.
- **Short links** (`spotify.link/...`) need a server-side redirect follow; they are rejected with a message like the existing `on.soundcloud.com` case.
- **Albums, playlists, shows** are collections. The embed can play them, but Mixtape's model is one row per track and the embed's internal next/previous would be invisible to the playlist. They return the existing `playlist` error for this iteration (section 28 lists the follow-up).

## 23. User Experience

- The **Add link** dialog accepts `open.spotify.com/track/<id>`, `open.spotify.com/intl-xx/track/<id>`, `open.spotify.com/episode/<id>`, and `spotify:track:<id>` / `spotify:episode:<id>` URIs. The provider line reads "Spotify". Title and artwork come from oEmbed; artist defaults to "Spotify" and is editable; duration is blank until the track first plays (the embed reports it).
- The playlist row shows a **Spotify** badge and a remove button, like other URL tracks.
- While a Spotify track is current, the cover slot shows the Spotify embed (its own artwork, title and Play button). On phones the cover is capped at 320 px, so the 280 px minimum is met; no layout change is needed.
- The volume slider and **M** shortcut remain usable for other tracks but show a one-line hint under the slider: "Volume for Spotify is controlled in the Spotify player." Media Session still reports title/artist/artwork; its play/pause/seek actions map to the controller.
- **Preview mode.** If the first `playback_update` reports a duration of about 30 s, the engine marks the row "Preview" and the Now Playing area shows "Log in to Spotify in this browser to hear the full track" with a link to `https://open.spotify.com/` (opens in a new tab). Mixtape cannot log the user in itself.
- Failure cases (removed track, region block, private episode) arrive as a `playback_update` that never starts or as a `ready` that never fires. A 10 s load timeout marks the track failed and skips it through the existing `state.failed` flow.
- Paste-to-add (Ctrl/Cmd+V) works unchanged because it already routes through `parse()`.

## 24. Architecture Changes

### 24.1 Parser (`js/url-tracks.js`)

- Remove `"spotify.com": "Spotify"` from `UNSUPPORTED`; add `"spotify.link": "Spotify short"` so short links get the explicit "can't be played" message.
- Accept hosts `open.spotify.com` and `play.spotify.com`, and the `spotify:` URI scheme (the existing `https://` prefixing already skips inputs that carry a scheme).
- Path shapes: `/(intl-[a-z]{2}(-[A-Za-z]{2})?/)?(track|episode)/<id>` where `<id>` is base62, 22 characters (`/^[A-Za-z0-9]{22}$/`). `/album/`, `/playlist/`, `/show/`, `/artist/` return `{ error: "playlist" }`. Anything else under the host returns `invalid`.
- Result: `{ provider: "spotify", kind: "track"|"episode", externalId: "spotify:track:<id>", canonicalUrl: "https://open.spotify.com/track/<id>", id: "url-spotify-<id>" }`. `externalId` is the URI because that is what `loadEntity` takes.
- `PROVIDER_NAMES.spotify = "Spotify"`; `SUPPORTED_TEXT` becomes "Mixtape can play direct audio/video links, SoundCloud, YouTube, Vimeo and Spotify."
- `OEMBED.spotify = (u) => "https://open.spotify.com/oembed?url=" + encodeURIComponent(u)`. `describe()` maps `title` and `thumbnail_url`; `author_name` is absent so artist falls back to "Spotify". No duration.

### 24.2 Engine (`js/engines/spotify.js`)

Follows `engines/youtube.js` closely.

```
API = "https://open.spotify.com/embed/iframe-api/v1"
ready(): loadScript(API) once; resolve when window.onSpotifyIframeApiReady(IFrameAPI) fires (chain any previous handler, as the YouTube engine does).
createSpotify({ container, handlers }):
  el = <div> appended to container
  controller created on first load(): api.createController(el, { width: "100%", height: 352, uri: track.externalId }, ctrl => { controller = ctrl; wire(); })
  wire():
    controller.addListener("ready", ...)            -> resolve load; cancel the 10 s watchdog
    controller.addListener("playback_update", e => {
        const { position, duration, isPaused, isBuffering, playingURI } = e.data;
        if (duration) handlers.onDuration(duration / 1000);
        handlers.onTime(position / 1000);
        playing state machine (24.3)
    })
  load(track, { autoplay }): await init; first time: create controller with uri; later: controller.loadEntity(track.externalId); if (autoplay) controller.play()
  play(): started ? controller.resume() : controller.play()
  pause(): controller.pause()
  seek(t): controller.seek(Math.round(t))        // integer seconds only
  setVolume()/setMuted(): no-op (document why)
  currentTime()/duration(): last values from playback_update
  destroy(): controller.destroy(); el.remove(); destroyed = true
```

One controller is reused across consecutive Spotify tracks via `loadEntity`; `player.js` destroys it when the provider changes, exactly as for YouTube.

`player.js` only needs `factories.spotify = createSpotify`. `providerOf()` already falls back to `direct` for unknown providers, so older persisted records are unaffected.

### 24.3 Deriving play, pause and end from `playback_update`

| Observation | Meaning | Handler |
|---|---|---|
| First update with `isPaused: false` after `load`/`play` | playback started | `onPlay()`; remember `started = true` |
| `isPaused` flips false → true while `position > 0` and `position < duration - 1500` | user or app paused | `onPause()` |
| `isPaused: true` and `position === 0` (or `position >= duration - 1500`) after the track had reached at least 50% | track ended (the embed rewinds to 0 and pauses) | `onEnded()` once; guard with a flag reset on the next `load` |
| No `ready` and no update within 10 s of `load` | embed failed to load or the item is unavailable | `onError(new Error("Spotify player did not load"))` |
| `duration` between 29 000 and 31 000 ms | preview mode | set `preview = true`; `ui.js` reads `state.preview` to show the login hint |

Position updates arrive several times a second, so no polling timer is required (confirm cadence in Step 0).

### 24.4 UI (`js/ui.js`, `index.html`, `css/style.css`)

- `$("cover").dataset.embed` becomes `["youtube", "spotify"].includes(t?.provider) ? t.provider : ""`; CSS gets `.cover[data-embed=spotify]` rules mirroring the YouTube ones (transparent background instead of black, since the Spotify embed draws its own card).
- Volume hint element under the slider, shown via `.player[data-provider=spotify]`.
- Preview hint and login link in the Now Playing area, driven by a new `state.preview` boolean that `player.js` resets to `false` on every track change.
- `index.html`: Add-link label and both meta descriptions list Spotify. The text badge is enough for the first pass; a sprite icon is optional.
- README "Add link" paragraph: Spotify is supported; full tracks need a Spotify login in the browser, otherwise 30 s previews.

### 24.5 Media Session

No change. `media-session.js` already reads `state`; the Spotify engine supplies `onTime`/`onDuration` so position state keeps working. `setPositionState` must tolerate `duration` arriving after `currentTime` (already the case for YouTube).

## 25. Implementation Steps

| Step | Work | Files | Est. |
|---|---|---|---|
| 0 | **Spike (2 h).** In a scratch HTML page served by `scripts/serve.mjs`: load the iFrame API, create a controller for one track, confirm `playback_update` cadence, what the stream looks like at track end (position/isPaused), whether `seek` works while paused, whether `play()` after `loadEntity()` autoplays in Chrome and Safari, whether the generated iframe carries `encrypted-media`, and the duration reported when logged out (preview) versus logged in. Append findings to section 30. | scratch only | 0.25 d |
| 1 | Parser: Spotify hosts, URI scheme, id regex, `intl-xx` prefix, collection → `playlist` error, `spotify.link` → unsupported. Unit tests in `tests/unit/url-parse.test.js` for each shape plus negatives. | `url-tracks.js`, tests | 0.5 d |
| 2 | oEmbed describe for Spotify; artist fallback "Spotify"; provider name and supported text; dialog label and meta descriptions. | `url-tracks.js`, `index.html` | 0.25 d |
| 3 | `engines/spotify.js` with lazy SDK load, controller reuse, state machine from 24.3, 10 s watchdog, no-op volume. Register in `player.js`. | `engines/spotify.js`, `player.js` | 1 d |
| 4 | Cover slot embed display, volume hint, preview hint, `state.preview` plumbing. | `ui.js`, `style.css`, `index.html`, `player.js` | 0.5 d |
| 5 | Playwright: route `https://open.spotify.com/embed/iframe-api/v1` to a stub script that calls `window.onSpotifyIframeApiReady` with a fake `IFrameAPI` whose controller records calls and lets the test emit `playback_update` events; route `https://open.spotify.com/oembed**` to a fixture. Assert row, badge, play/pause mapping, end-of-track advance, preview hint. | `tests/links.spec.js` (or `tests/spotify.spec.js`) | 0.75 d |
| 6 | Manual pass: one real track and one episode in Chrome, Firefox, Safari desktop and Android Chrome, logged out and logged in; keyboard shortcuts; lock-screen controls. | checklist | 0.25 d |
| 7 | Docs: README, CLAUDE.md engine list, `technical.md` stack row, section 30 findings. | docs | 0.25 d |

Total: roughly 3.75 developer-days. Steps 1-2 alone make Spotify links recognised and described; Step 3 makes them play.

## 26. Testing Strategy

- **Unit (Node):** `parse()` table: `open.spotify.com/track/<id>`, `/intl-de/track/<id>?si=...`, `/episode/<id>`, `spotify:track:<id>`, `play.spotify.com/track/<id>`, 21- and 23-character ids (invalid), `/album/`, `/playlist/`, `/show/` (playlist error), `spotify.link/abc` (unsupported), `spotify.com/` root (invalid). Deterministic id equality for URL and URI forms of the same track.
- **Browser (Playwright, no network):** stub the SDK script and oEmbed as in Step 5. Cases: add and persist; badge text; controller created with the URI; `#play` toggles via `resume`/`pause`; emitting an end-of-track update advances to the next row; a 30 s duration shows the preview hint; no `ready` within the (shortened for test) watchdog marks the row failed and skips.
- **Manual:** real embeds cannot be automated reliably; keep the Step 6 checklist in this file and tick it before release.

## 27. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Logged-out visitors only hear 30 s previews and think the player is broken. | Detect preview duration, label the row "Preview", show the login hint with a link to open.spotify.com. Say so in README and the dialog's provider line. |
| Spotify changes or removes the iFrame API. | Engine fails to `state.failed` through the 10 s watchdog; the SDK URL lives in one constant. Nothing else in the app depends on Spotify. |
| Volume slider does nothing for Spotify and confuses users. | Hint text while a Spotify track is current. Do not try to emulate volume by muting the iframe; the embed exposes no such control and overlaying it would breach the terms. |
| End-of-track inference misfires (double `onEnded`, or none). | One-shot flag reset on `load`; require the track to have reached 50% before accepting an end signal; cover both the rewind-to-zero and the position-near-duration patterns found in the spike. |
| Embed terms: player hidden, resized below 280 px, or overlaid. | Reuse the YouTube visibility rule; cover slot is 320 px minimum on phones; no custom controls drawn over the iframe. |
| Users paste album or playlist links expecting the whole thing. | Clear "Playlists aren't supported yet" message (already exists). Possible later feature: expand a collection into rows via the Web API, which needs a token (section 28). |
| Third-party script and cookies from Spotify load when a Spotify track exists. | Lazy-load only when a Spotify track is first played, like the other SDKs. Mention Spotify in the README privacy note. |
| Short links (`spotify.link`) cannot be resolved client-side. | Explicit message asking for the full `open.spotify.com` link (Share > Copy link on desktop). |

## 28. Follow-up Options (Not in This Iteration)

- **Metadata via the Web API.** A serverless function holding a Client Credentials token (same deployment model as section 17) could return artist, album, duration and a 640 px cover for a Spotify id, and expand album/playlist links into individual rows. Mixtape would call it through a `config.json` `spotifyMetadataUrl`. The Web API deprecations of November 2024 (no 30 s `preview_url` for new apps, no audio features) do not affect basic track lookup.
- **Web Playback SDK tier.** Full-length audio-only playback with volume control for Premium listeners who log in with PKCE. Blocked today by Development Mode's user cap and the non-commercial clause; revisit if Spotify's quota policy changes. Would be a separate engine (`spotify-sdk`) chosen when a valid token is present, falling back to the embed engine otherwise.
- ~~**Collection rows.**~~ Done (2026-11-09): album, playlist, show and artist links are one row each; the embed plays through the items, `playingURI` drives the Now Playing heading via oEmbed, and the row ends when the embed goes quiet after the last item. Mixtape's next/previous still move between rows; moving within the collection is done in the embed's own track list.
- **"Open in Spotify" action** on the row and in Media Session, using `canonicalUrl`.

## 29. Acceptance Criteria

1. Pasting an `open.spotify.com` track or episode link, or a `spotify:` URI, adds one row with a Spotify badge, the oEmbed title and artwork, and an editable artist. Pasting the URL and URI of the same track produces one row.
2. The row plays through the visible Spotify embed in the cover slot; play, pause, seek, next/previous, shuffle and repeat, keyboard shortcuts and Media Session actions all work. Position and duration update live.
3. When the embed reaches the end of a track, the playlist advances exactly once.
4. Logged-out playback shows the "Preview" label and the login hint; logged-in playback shows neither.
5. Album, playlist, show and `spotify.link` links show explanatory messages and add nothing.
6. A Spotify item that fails to load is skipped with the existing "can't be played" message within about 10 s.
7. No Spotify script or cookie loads until a Spotify track is played.
8. All existing unit and browser tests pass; new unit tests cover the parser shapes in section 26 and a stubbed browser test covers the engine mapping and end-of-track advance.

## 30. Spike Findings (2026-11-09)

**Status: implemented** (steps 1-5 and 7 of section 25 are done; the manual cross-browser pass in step 6 is still owed). Files: `js/engines/spotify.js`, `js/url-tracks.js`, `js/player.js`, `js/state.js`, `js/ui.js`, `index.html`, `css/style.css`, `tests/unit/url-parse.test.js`, `tests/links.spec.js`, `tests/smoke.spec.js`. The same change made the layout work down to a 320 px viewport (see "Responsive layout" below).

**Live check against the real embed (headless Chromium, logged out, autoplay allowed):**

| Check | Result |
|---|---|
| Script load and controller creation | `createController` called with `{ width: "100%", height: 352, uri }`; `ready` fired exactly once, after the controller callback. The API object exposes `createController` and `supportsVideo`. |
| Generated iframe | `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"`, `loading="lazy"`, src `open.spotify.com/embed/track/<id>?utm_source=iframe-api`. Rendered at 338 x 352 px in the desktop cover slot. The element passed to `createController` is replaced by the iframe, so the engine wraps it in its own `div.sp` and removes that on destroy. |
| `playback_update` stream | First event has `playingURI: ""` and `duration: 0`; the second carries the real URI and duration. Then roughly **one event per second** (median gap 1064 ms), so the seek bar steps once a second while a Spotify track plays. Smoother motion would need client-side interpolation between events (not done). |
| Preview mode | Logged-out duration was **29 713 ms**, inside the 29-31 s detection window; the "Preview only" hint appeared and `#dur` showed 0:29. The embed itself also labels the track "Preview". |
| Autoplay after load | `controller.play()` after `ready` started playback without a gesture when Chromium allowed autoplay. Real browsers require the click that Mixtape already has. |
| oEmbed | `title` and 300 px `thumbnail_url` returned; artist absent, so the row shows "Spotify" until edited. |

**End of track and collections (live, later the same day):** `seek()` works during playback. At the end of an item the embed reports `position === duration` with `isPaused: false` and then **sends nothing more**: no pause, no rewind. In an album the next item's update (`playingURI` changes, `position: 0`) follows within about 100 ms, and after the last item nothing follows at all. The engine therefore treats "reached the end, then no progress for 1.2 s on the same item" as ended, and keeps the pause/rewind heuristics only as a fallback. Verified: a single track advanced to the next row about 4 s after its end; an 8-track album walked through every item (heading showed each title via oEmbed on the `spotify:track:` URI) and advanced to the next row after the last; a mid-track pause stayed a pause. oEmbed accepts bare URIs and names albums, playlists and artists.

Not yet verified live: Safari and Firefox, a logged-in session, and switching between two Spotify rows via `loadEntity`. These remain the step 6 manual checklist.

**Implementation notes that differ from sections 24.2-24.3:**

- The first `load()` resolves when the controller callback runs, not on `ready`; `ready` is awaited (capped at 3 s) only before the first `play()`. This avoids hanging if `ready` ever fires before a listener is attached. The 10 s watchdog covers script or controller failure.
- Events whose `playingURI` is non-empty and differs from the current track are ignored, which keeps a stale update from the previous entity from flipping play state after `loadEntity`.
- Preview state travels through a new optional engine handler `onPreview`, mirrored by `player.js` into `state.preview` and reset to `false` on every track change.

**Responsive layout (same change):** the playlist row grid used `1fr` for the title column, whose automatic minimum is the unwrapped artist name; a long artist pushed the whole page 4 px wider than a 320 px phone. Fixed with `minmax(0,1fr)` and `min-width:0`, plus smaller paddings below 400 px so the cover slot stays at least 280 px wide (the Spotify minimum), icon-only header buttons below 480 px and in the tight two-column range 761-960 px, and a safe-area bottom inset. A smoke test now checks the 320 px viewport for overflow, cover width, and collapsed labels.

**Desk check (before implementation):**

| Check | Result |
|---|---|
| Spotify oEmbed (`open.spotify.com/oembed?url=...`) CORS | Allowed: `Access-Control-Allow-Origin: *`. Response fields: `title`, `thumbnail_url` (300x300), `thumbnail_width/height`, `iframe_url`, `html`, `provider_name`, `width`, `height`, `type: "rich"`. **No artist and no duration.** |
| iFrame API script (`open.spotify.com/embed/iframe-api/v1`) | HTTP 200, `text/javascript`. Loaded with `<script async>`; signals readiness through the global `window.onSpotifyIframeApiReady(IFrameAPI)`. |
| Controller surface (official reference) | `createController(element, { uri|url, width, height }, cb)`; methods `loadEntity(uriOrUrl, preferVideo?, startAt?)`, `loadUri`, `play`, `pause`, `resume`, `togglePlay`, `restart`, `seek(seconds)`, `destroy`; events `ready`, `playback_started`, `playback_update` with `position`/`duration` in ms, `isPaused`, `isBuffering`, `playingURI`. No volume method; no `ended` event. |
| Minimum rendered width | 280 px (official tutorial). Mixtape's `.cover` is 320 px maximum on phones and larger on desktop, so the slot qualifies. |
| Embed iframe attributes | oEmbed `html` uses `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"`. The iFrame API creates its own iframe; confirm in Step 0 that it carries `encrypted-media`, which full-length playback needs. |
| Preview versus full playback | Documented behaviour: 30 s preview unless the visitor is logged in to Spotify in that browser. Community reports show previews persisting for some logged-in users and in mobile-sized viewports; treat preview as a normal state, not an error. |
| Web Playback SDK requirements | Premium account; Chrome, Firefox, Safari, Edge; iframes must allow `encrypted-media` and `autoplay`; non-commercial use only without written approval. Development Mode user cap and the 250,000 MAU extended-quota rule make it unsuitable for a public site; not pursued. |

Of the items originally left for Step 0, cadence, iframe attributes, autoplay after the controller is ready, and preview duration are now verified above; end-of-track pattern, seek while paused, and `loadEntity` between two Spotify tracks remain manual.

---

# Part D: Usage Audit Log

## 31. Goal

Keep a durable, owner-readable record of:

1. **Who is using the app**: each visit, with the visitor's IP address, approximate location, and device (browser, operating system, device type, screen, language).
2. **What they add**: every pasted link, Cloudinary upload and device-only file, with the full link and the details Mixtape already holds (title, artist, provider, duration, cover).
3. **What they listen to**: every track played, for how long, and whether it finished, was skipped or failed.
4. **A catalogue of every link ever seen**, with its details, independent of whether the visitor later removes it from their own playlist.

Logging is on for every visitor whenever the collector is configured, with no per-user switch.

## 32. Constraints That Shape the Design

| Constraint | Consequence |
|---|---|
| **Mixtape is a static site on GitHub Pages.** There is no server, GitHub exposes no access logs, and browser JavaScript cannot read the visitor's own public IP address. | A small server-side **collector** is required. It reads the IP from the incoming request, so the client never reports (and cannot forge) its own address. |
| **Personal tracks live only in the visitor's browser** (IndexedDB). The owner currently has no view of pasted links at all. | The client must send each added link and its details to the collector at the moment it is added. |
| **No secrets in this repo** (CLAUDE.md, Cloudinary section). | The collector is a separate deployment with its own environment. `config.json` holds only its public URL. |
| **"Device" on the web means browser-reported data.** User-Agent string, Client Hints (platform, model on Android Chrome), screen size, language, time zone. There is no device name, serial number or MAC address available to a web page. | The log identifies a browser install through a random visitor id kept in `localStorage`, plus the device description. Clearing site data or using a private window produces a new visitor id; the IP address still links the sessions. |
| **An IP address identifies a network, not a person.** Mobile carriers, offices and VPNs share or rotate addresses. | Store IP together with visitor id and session id; none of the three alone is "who". |
| **Client-side logging is best effort.** Content blockers can block the collector's domain, and anyone can post invented events to a public endpoint. | Treat the log as a usage record, not as forensic proof. Mitigations in section 38. A visit that is blocked entirely leaves no trace; nothing on a static host can change that. |
| **IP address plus listening history is personal data** under GDPR, UK GDPR, CCPA and similar laws. | A visible notice in the app, a privacy section in the README, a retention period, and a way to delete one visitor's records (section 37). These are owner decisions listed in section 41. |
| **Browser tests must never hit the network** (CLAUDE.md, testing notes). | Auditing is disabled when `config.json` has no `audit.endpoint`; the existing `{}` stub already turns it off. |

## 33. Collector: Options and Recommendation

| Option | IP and location | Storage | Cost | Notes |
|---|---|---|---|---|
| **Cloudflare Worker + D1 (recommended)** | `CF-Connecting-IP` header; `request.cf` gives country, city, region, ASN and time zone | D1 (SQLite), SQL queries | Free plan (limits to be confirmed in step D0) | One file of JavaScript, deploys with `wrangler`, scheduled triggers for retention, built-in rate limiting. Same platform section 17 already proposes for signed uploads, so the two can share a Worker later. |
| Netlify / Vercel function + hosted Postgres (Neon, Supabase) | `x-forwarded-for`, `x-vercel-ip-country` | Postgres | Free tiers | Two vendors to configure instead of one. |
| Supabase only (client writes straight to a table) | Not available to a plain insert; needs an Edge Function anyway | Postgres | Free tier | No advantage over a Worker. |
| Third-party analytics (Plausible, GA4, PostHog) | Most hide or truncate IPs by design | Vendor | Varies | Does not meet the "which IP, which link" requirement. Rejected. |

**Recommendation: one Cloudflare Worker with a D1 database**, source kept in a `collector/` folder of this repository (Worker source is harmless to publish; secrets are set with `wrangler secret put` and never committed). If the owner prefers, the same folder can live in a separate private repository with no other change.

## 34. What Is Logged

All events share an envelope added by the client: `visitorId`, `sessionId`, `ts` (client clock, ms), `seq` (per-session counter), `type`. The collector adds `receivedAt`, IP and location to the session row.

| Event | When | Fields |
|---|---|---|
| `session_start` | Once per page load, after the playlist is built | `userAgent`, Client Hints when available (`platform`, `platformVersion`, `model`, `mobile`, browser brand and version), `screen` (w x h, device pixel ratio), `viewport`, `language`, `timeZone`, `referrer`, `standalone` (installed/PWA), counts of repo / shared / personal tracks, and a **library snapshot**: the list of personal track records already in the browser (so links added before auditing existed are captured on the next visit). |
| `track_add` | A track id appears in `state.tracks` after startup | `trackId`, `source` (`url` / `local`), `provider`, `url` (the canonical link, or the Cloudinary delivery URL), `externalId`, `kind` (Spotify), `title`, `artist`, `duration`, `cover`, `shared` (Cloudinary shared tag), and for files `fileName`, `bytes`, `mime`. The audio content of device-only files is never sent. |
| `track_remove` | A track id disappears from `state.tracks` | `trackId` |
| `play_start` | A track first reaches `playing: true` after becoming current | `trackId`, `source`, `provider`, `title`, `artist`, `url`, `duration`, `preview` (Spotify 30 s preview), `shuffle`, `repeat` |
| `play_end` | The current track changes, ends, fails, or the page is hidden | `trackId`, `listenedSec` (wall-clock time spent in `playing: true`, so seeking does not inflate it), `positionSec`, `durationSec`, `reason`: `ended` / `skipped` / `error` / `closed` |
| `collection_item` | `state.item` changes while a Spotify album, playlist, show or artist row plays | `trackId` of the row, `itemUri`, resolved item title when available |
| `play_error` | A track id is added to `state.failed` | `trackId`, `url`, the message from `state.error` |

Notes:

- Repo and shared tracks are logged on play like any other; their details come from `data/tracks.json` and the Cloudinary list, so `track_add` is not emitted for them.
- Unlisted Vimeo links carry a private `hash`. Logging the full link stores that hash in the audit database; that is intended (the requirement is to keep the links), and it is one reason the database must stay private.
- No seek, volume, theme or keyboard events. They add volume without answering "who, what, which link".

## 35. Architecture

### 35.1 Configuration

`config.json` gains a public, committable block:

```json
"audit": {
  "endpoint": "https://mixtape-audit.<account>.workers.dev/v1/events",
  "flushSeconds": 15
}
```

A missing or empty `endpoint` disables auditing completely: no visitor id is created and no request is made.

### 35.2 New module `js/audit.js`

Follows the existing rule that modules do not call each other to report things; it is a **state subscriber**, so `ui.js`, `player.js`, `playlist.js` and the engines need no changes.

| Export | Behaviour |
|---|---|
| `configure(cfg)` | Stores the endpoint. Reads or creates `visitorId` (`crypto.randomUUID()`, kept through `storage.js` as `music-player:visitor`) and a fresh `sessionId` per page load. |
| `start()` | Called from `app.js` once, right after `playlist.setTracks(...)`. Records the baseline set of track ids, sends `session_start` with the library snapshot, then subscribes to state. |
| `diff(prev, next)` (pure, unit-tested) | Given two reduced snapshots `{ ids, currentId, playing, failed, item }`, returns the events to emit. All detection logic lives here so it runs under `node --test` without a browser. |
| `describe(track)` (pure, unit-tested) | Maps a track object to the logged fields in section 34. |

Internals:

- **Listening time.** A small accumulator adds wall-clock time while `playing` is true for the current track id and closes into `play_end` on track change, end, error or page hide. `timeupdate`-driven state changes are ignored unless one of the watched fields changed, so the subscriber costs a few comparisons per tick.
- **Batching.** Events queue in memory and flush every `flushSeconds`, when the queue reaches 20 events, and on `visibilitychange` to hidden and `pagehide`. Flushes use `fetch(endpoint, { method: "POST", keepalive: true, body })` with `Content-Type: text/plain` so no CORS preflight is needed; the page-hide flush uses `navigator.sendBeacon`.
- **Offline and failures.** A failed batch is kept in `localStorage` (`music-player:audit-queue`, capped at 200 events, oldest dropped) and retried on the next flush or next visit. Failures are silent: auditing must never surface an error or delay playback.
- **Upload details.** `track_add` for a file needs `fileName`, `bytes` and `mime`, which are not on the track object. `local-files.js` and `cloud-upload.js` add those three fields to the track they already return (`file: { name, bytes, mime }`); `audit.describe()` reads them. This is the only change to existing modules besides `app.js`.

### 35.3 Changes to existing files

| File | Change |
|---|---|
| `js/app.js` | `audit.configure(config.audit)` beside `cloud.configure(...)`; `audit.start()` after `playlist.setTracks(...)`. |
| `js/local-files.js`, `js/cloud-upload.js` | Attach `file: { name, bytes, mime }` to new tracks (not persisted beyond what is already stored). |
| `index.html`, `css/style.css`, `js/ui.js` | One-time dismissible notice and a permanent "Privacy" link in the footer (section 37). New ids: `#audit-notice`, `#audit-notice-ok`. |
| `config.json` | The `audit` block. |
| `README.md` | New Privacy section. |
| `CLAUDE.md`, `technical.md` | Module table, config notes, test stubs. |

### 35.4 Collector (`collector/`)

```
collector/
  wrangler.toml        D1 binding, rate-limit binding, cron trigger, ALLOWED_ORIGINS var
  schema.sql           tables below
  src/index.js         the Worker
  README.md            deploy and query instructions
```

Endpoints:

| Route | Auth | Behaviour |
|---|---|---|
| `POST /v1/events` | None (public). Checked: `Origin` in `ALLOWED_ORIGINS`, body under 64 KB, at most 50 events, each event validated against the section 34 shapes, strings truncated to fixed lengths, per-IP rate limit. | Upserts the session row with IP, location and device; inserts events; upserts the track catalogue. Responds `204`. |
| `GET /v1/admin/sessions`, `/events`, `/tracks` | `Authorization: Bearer <ADMIN_TOKEN>` (a Worker secret), or Cloudflare Access in front of `/v1/admin/*` | Filterable JSON or CSV (`?format=csv`, `?from=`, `?to=`, `?ip=`, `?visitor=`, `?track=`). |
| `DELETE /v1/admin/visitors/:id` | Same | Removes one visitor's sessions and events (erasure requests). |
| Cron trigger, daily | n/a | Deletes sessions and events older than `RETENTION_DAYS`. The track catalogue is kept. |

Device parsing: the Worker stores the raw User-Agent and Client Hints and derives `browser`, `os` and `deviceType` (`mobile` / `tablet` / `desktop`) with a small built-in matcher, so the admin views are readable without a dependency.

### 35.5 Data model (D1)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- sessionId from the client
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,    -- server time, ms
  last_seen_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  country TEXT, region TEXT, city TEXT, asn INTEGER, as_org TEXT,
  user_agent TEXT, browser TEXT, os TEXT, device_type TEXT, device_model TEXT,
  screen TEXT, language TEXT, time_zone TEXT, referrer TEXT
);
CREATE INDEX sessions_visitor ON sessions (visitor_id, started_at);
CREATE INDEX sessions_ip ON sessions (ip, started_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  visitor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  client_ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  ip TEXT NOT NULL,               -- repeated: the address can change mid-session
  type TEXT NOT NULL,
  track_id TEXT,
  listened_sec REAL,
  reason TEXT,
  detail TEXT,                    -- JSON for the remaining fields
  UNIQUE (session_id, seq)        -- makes retried batches idempotent
);
CREATE INDEX events_track ON events (track_id, received_at);
CREATE INDEX events_type ON events (type, received_at);

CREATE TABLE tracks (             -- every link ever added or played, with details
  track_id TEXT PRIMARY KEY,
  source TEXT, provider TEXT, kind TEXT,
  url TEXT, external_id TEXT,
  title TEXT, artist TEXT, duration REAL, cover TEXT,
  file_name TEXT, bytes INTEGER, mime TEXT,
  first_seen_at INTEGER NOT NULL, first_visitor_id TEXT, first_ip TEXT,
  last_seen_at INTEGER NOT NULL,
  add_count INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  listened_sec REAL NOT NULL DEFAULT 0
);
```

Because URL track ids are deterministic (`url-<provider>-<id>`, `cloud-<public_id>`), the same link pasted by different visitors lands on one `tracks` row with a rising `add_count`.

## 36. Reading the Log

Phase 1 needs no UI: the Cloudflare dashboard's D1 console, `wrangler d1 execute`, and the CSV endpoints cover the questions the log exists to answer. `collector/README.md` ships these as saved queries:

- Visitors in a date range, with IP, location, device, session count and total listening time.
- Everything one IP address or visitor id did, in order.
- All links added, newest first, with who added them and from where.
- Most played tracks, and who played a given track.

Phase 2 (optional): a single read-only admin page served by the Worker itself at `/v1/admin/`, protected by Cloudflare Access, with those four views as tables. It is deliberately not part of the public GitHub Pages site.

## 37. Privacy and Disclosure

- **Notice.** On first visit with auditing enabled, a dismissible bar: "Mixtape keeps a usage log: your IP address, device details, the links and files you add, and what you play. See Privacy." Dismissal is remembered in `localStorage`. Logging starts immediately, as the requirement asks; whether it should instead wait for a click is the owner's decision in section 41, since visitors from the EU/UK generally must agree first.
- **README Privacy section.** What is collected, why, where it is stored (Cloudflare), how long, who can read it (the owner only), and how to ask for deletion. The README currently has no privacy section; the Cloudinary and Spotify privacy notes called for in step B7 and section 27 go into the same section.
- **Retention.** `RETENTION_DAYS` on the Worker, proposed default 365. Sessions and events are purged after that; the track catalogue (links and details, with `first_ip` cleared at the same age) is kept indefinitely.
- **Erasure.** `DELETE /v1/admin/visitors/:id`; the visitor id is shown on the Privacy link's panel so a visitor can quote it.
- **Access.** The database is readable only through the Cloudflare account and the admin token. No read endpoint is public.

## 38. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **Forged or spam events.** The write endpoint is public and its URL is in `config.json`. | `Origin` allowlist (stops other websites; does not stop scripts), strict schema and length limits, 64 KB body cap, Cloudflare rate-limiting binding per IP (for example 60 requests/minute), `UNIQUE (session_id, seq)`. The IP column is always the real sender's. Optional later: Cloudflare Turnstile token on `session_start`. |
| **Content blockers stop the request.** | A `workers.dev` host with a neutral path is less likely to be on block lists than an analytics vendor. Routing the Worker under a custom domain owned by the site is the stronger fix. Blocked visitors are simply not logged. |
| **Events lost when the tab closes.** | Flush on `visibilitychange` and `pagehide` with `sendBeacon`; unsent events persist in `localStorage` and go out on the next visit. `play_end` with reason `closed` is therefore sometimes late, never duplicated. |
| **Free-plan limits** on Worker requests and D1 writes per day. | Batching keeps a typical session to a handful of requests, far below any plausible limit at demo scale; confirm the current numbers in step D0. If D1 rejects a write the Worker still returns `204` and drops the batch, so the app is never affected. |
| **Audit code breaks playback.** | The subscriber is wrapped in `try/catch`, does no DOM work, and never awaits in the state path. With no endpoint configured the module is inert. |
| **Sensitive links in the log** (unlisted Vimeo hashes, private Cloudinary URLs). | Database is private; admin endpoints require the token or Access; CSV exports are the owner's responsibility. |
| **Legal exposure from collecting IP addresses without notice.** | Section 37. The notice and README text ship in the same change as the logging, not after. |
| **Tests accidentally reach the collector.** | Disabled under the existing `{}` config stub; the new audit tests route the endpoint with `page.route()` and assert on captured bodies. |

## 39. Implementation Steps

| Step | Work | Files | Est. |
|---|---|---|---|
| D0 | Owner creates a Cloudflare account and decides the items in section 41. Spike: deploy a ten-line Worker, confirm `CF-Connecting-IP` and `request.cf` values, confirm a `text/plain` `fetch` with `keepalive` and a `sendBeacon` from the GitHub Pages origin both arrive without preflight, note the current free-plan limits. | scratch only | 0.25 d |
| D1 | Collector: `schema.sql`, `POST /v1/events` with validation, rate limit, session upsert, event insert, catalogue upsert, UA matcher. Tested locally with `wrangler dev` and a local D1. | `collector/` | 1.25 d |
| D2 | `js/audit.js`: `configure`, `start`, pure `diff` and `describe`, listening-time accumulator, batching, offline queue. Node unit tests for `diff` (add, remove, play, skip, end, error, collection item, no event on plain time ticks) and `describe` (each provider, local file, shared track). | `js/audit.js`, `tests/unit/audit.test.js` | 1.25 d |
| D3 | Wire into `app.js`; add `file` details in `local-files.js` and `cloud-upload.js`; `config.json` block. | `js/app.js`, `js/local-files.js`, `js/cloud-upload.js`, `config.json` | 0.25 d |
| D4 | Notice bar, Privacy panel with visitor id, footer link; 320 px layout check. | `index.html`, `css/style.css`, `js/ui.js` | 0.5 d |
| D5 | Playwright: with a routed endpoint, loading the page posts `session_start`; adding a link posts `track_add` with the canonical URL; playing the fixture tone to the end posts `play_start` and `play_end` with reason `ended`; with `{}` config no request is made and no visitor id is stored. | `tests/audit.spec.js` | 0.75 d |
| D6 | Admin read endpoints with CSV, visitor delete, retention cron, saved queries. | `collector/` | 0.75 d |
| D7 | README Privacy section, CLAUDE.md and `technical.md` updates, collector deploy notes. | docs | 0.25 d |
| D8 (optional) | Admin page behind Cloudflare Access. | `collector/` | 1 d |

Total: about 5.25 developer-days without D8.

## 40. Acceptance Criteria

1. With `audit.endpoint` set, opening the app creates one session row holding the visitor's IP address, country and city, browser, operating system, device type and screen size.
2. Pasting a link, uploading to Cloudinary, and adding a device-only file each produce a `track_add` event and a `tracks` row containing the link (or file name) and the title, artist, provider and duration shown in the playlist.
3. Tracks that were already in a visitor's browser before auditing shipped appear in the catalogue after that visitor's next visit.
4. Playing a track produces `play_start`, and exactly one `play_end` whose `listenedSec` is within 2 seconds of the real listening time and whose `reason` matches what happened (ended, skipped, error, closed).
5. The owner can answer, with one saved query or CSV export each: who visited in a period and from which IP and device; what one IP did; which links were added and by whom; who listened to a given track.
6. With `audit.endpoint` missing or empty, no request is sent, nothing is written to `localStorage` for auditing, and the app behaves exactly as it does today.
7. A collector outage, a blocked request or an offline device causes no visible error and no playback delay; queued events are delivered on a later visit.
8. The notice appears on first visit, the README states what is collected and for how long, and one visitor's records can be deleted by id.
9. No token, secret or database credential exists in this repository or in any request the page makes.
10. All existing unit and browser tests pass, and no test makes a real network request.

## 41. What the Owner Needs to Provide or Decide

| Item | Options | Proposed default |
|---|---|---|
| Cloudflare account and Worker name | Free plan is enough | `mixtape-audit` on `workers.dev` |
| Where the collector source lives | `collector/` in this repo, or a separate private repo | `collector/` here |
| Notice model | Log immediately with a notice, or log only after the visitor clicks OK | Log immediately with a notice (matches "always"); switch to click-first if EU/UK visitors are expected |
| Retention | 90 days, 365 days, or indefinite | 365 days for sessions and events; catalogue kept |
| Admin access | Bearer token, or Cloudflare Access with the owner's email | Token for phase 1 |
| Allowed origins | The GitHub Pages URL, plus `http://localhost:8000` for development | Both |
| Contact for deletion requests | An email address or issue link to print in the README | Owner to supply |
