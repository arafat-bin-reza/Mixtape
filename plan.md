# Plan: External Links as Audio, and Cloudinary Storage for Uploads

This plan has two parts that share one playback path:

- **Part A** (sections 1-10): paste a link to a video or audio hosted elsewhere and play it as an audio track.
- **Part B** (sections 11-19): let a listener upload media to Cloudinary so it is stored in the cloud rather than only in their browser, and play it back through the same direct-URL path as Part A.

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
