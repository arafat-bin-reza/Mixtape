# Plan: clear the "Add a link" dialog after a link is added

## 1. Goal

After a link is added to the playlist, every field of the "Add a link" dialog (`#link-dialog`) is empty, so the next time the dialog opens nothing from the previous link is left in it.

## 2. Current behaviour

All of the dialog logic is in `js/ui.js`.

- `submitLink()` saves the track, calls `addTracks()`, closes the dialog and shows a toast. It clears nothing itself.
- The dialog's `close` listener runs `linkSeq++; resetLink()`. `resetLink()` only drops `linkPending`, disables `#link-add`, hides `#link-preview` and empties `#link-status`.
- `openLinkDialog(prefill = "")` overwrites `#link-url` with the prefill when the dialog is next opened.

What is left behind after an add:

| Field | State after add | Cleared today? |
|---|---|---|
| `#link-url` | still holds the added URL | only on the next open, by `openLinkDialog` |
| `#link-title-input` | still holds the title (including the user's edit) | no, hidden with the preview and overwritten by the next successful lookup |
| `#link-artist` | still holds the artist | no, same as the title |
| `#link-cover` | `src` still points at the previous cover | no, hidden with the preview |
| `#link-provider` | still holds the previous provider/duration text | no, hidden with the preview |
| `#link-status` | empty | yes |
| `#link-add` | disabled | yes |
| pending debounce (`linkTimer`, 400 ms) | can still fire `checkLink()` after the dialog has closed | no |

So the stale values are hidden rather than cleared, and the URL field is only emptied as a side effect of the next open. The debounce is the one path that can show stale state: closing within 400 ms of typing lets `checkLink()` run against the closed dialog and fill it again.

## 3. Design

Clear the whole form in one place, on the dialog's `close` event, instead of relying on the next open.

- **Where:** extend the existing `close` listener. `close` fires after a successful add, after Cancel and after Esc, so all three leave the dialog empty. This is a superset of the request (clearing only after an add would need a second code path and would leave Cancel/Esc with the hidden stale values); if clearing must happen strictly after an add only, move the call into `submitLink()` instead.
- **What:** a new `clearLinkForm()` next to `resetLink()`:
  - `$("link-form").reset()` empties `#link-url`, `#link-title-input` and `#link-artist` (none has a default value in `index.html`);
  - `#link-cover`: remove `src`, set `hidden`;
  - `#link-provider`: `textContent = ""`;
  - cancel the pending debounce with `clearTimeout(linkTimer)`;
  - `linkSeq++` and `resetLink()` as today (pending link, Add button, preview, status).
- **`linkTimer`** is currently a local inside `initUI()`. Hoist it to module scope beside `linkSeq` / `linkPending` so `clearLinkForm()` can cancel it.
- **`resetLink()` stays as it is.** `checkLink()` calls it on every keystroke lookup, where the URL the user is typing must not be wiped.
- **Failure case unchanged:** if `urlTracks.save()` throws, `submitLink()` never reaches `close()`, so the dialog stays open with the user's input intact.
- **Paste-to-add unchanged:** `openLinkDialog(text)` sets `#link-url` after the previous close has already cleared it, so the prefill still works.

No change to `index.html`, CSS, state, or any other module. No element ids change.

## 4. Changes

`js/ui.js` only:

1. Move `let linkTimer;` from `initUI()` to the module-level `let linkSeq = 0, linkPending = null;` line.
2. Add `clearLinkForm()` as described in §3.
3. Change the listener to `$("link-dialog").addEventListener("close", clearLinkForm);`.

About ten lines in total.

## 5. Tests

Add one browser test to `tests/links.spec.js` (it already stubs `config.json` to `{}` and uses the `TONE` fixture, so nothing new touches the network):

1. Open the dialog, fill `#link-url` with `TONE`, wait for `#link-add` to be enabled, edit `#link-artist`, click `#link-add`.
2. With the dialog closed, assert `#link-url`, `#link-title-input` and `#link-artist` have value `""`, `#link-provider` has empty text, and `#link-cover` has no `src`.
3. Click `#add-link` again and assert `#link-url` is empty, `#link-preview` is hidden, `#link-status` is empty and `#link-add` is disabled.

A second short case covers Cancel: fill the URL, wait for the preview, click `#link-cancel`, assert the same fields are empty.

Existing tests that must still pass unchanged: the duplicate-link test (reopens the dialog and fills the same URL), the paste-prefill test, and the YouTube and Spotify add flows.

## 6. Verification

```bash
npx playwright test tests/links.spec.js
npm test
```

In PowerShell, when port 8000 is taken: `$env:PORT = 8010; npx playwright test tests/links.spec.js`.

Manual check with `npm run serve`: add a link, reopen the dialog (empty), paste a link on the page (prefilled and looked up), type a URL and press Esc within 400 ms, then reopen (empty, no late lookup result).

## 7. Out of scope

- The upload dialog (`#upload-dialog`), which already resets its queue on close.
- Keeping the dialog open after an add so several links can be added in a row.

---

# Plan: accept any kind of audio or video file when uploading a song, and play it as audio

## 1. Goal

"Add files" (the picker and drag-and-drop) accepts any audio or video file, not only the twelve extensions on today's whitelist. A file is turned away in the browser only when it is clearly neither audio nor video, or is over the size limit. A video is always played as an audio song: only its soundtrack is heard, no picture is shown, and it sits in the playlist like any other track.

## 2. Current behaviour

There are three separate format gates, and they disagree with each other.

| Gate | Where | Rule today |
|---|---|---|
| File picker | `index.html`, `#file` `accept` | `audio/*,video/*` plus 12 extensions. Drag-and-drop bypasses it. |
| Cloud upload | `cloud-upload.js` `validate()` | The extension must be in `allowedFormats` from `config.json` (falls back to `DEFAULT_FORMATS`). The MIME type is ignored, so `song.aiff` or `voice.amr` is refused with "not a supported format" even though the browser reports `audio/*`. |
| Device-only fallback | `local-files.js` `isAudioFile()` | MIME starts with `audio/` or `video/`, **or** the extension is in `AUDIO_EXT` (the same 12). Then `probe()` must be able to read a duration, so the browser's own decoder is the real limit. |

A refused row in the upload dialog shows the error and a "Keep on this device only" button, and Upload is disabled when every row is refused.

There is a fourth gate outside the repo: the Cloudinary preset `mixtape-unsigned`. The original design notes recommended setting its "Allowed formats" to `mp3,m4a,aac,ogg,opus,wav,flac,mp4,webm,mov` in the console. Whether that was done is not visible from the code. If it was, Cloudinary refuses anything else no matter what the browser allows.

Playback does not depend on the uploaded format: `toRecord()` always plays the `<public_id>.mp3` rendition, so anything Cloudinary can decode plays in every browser.

Video is already played as audio today, for the four video extensions on the whitelist (`mp4 m4v webm mov`), and nothing in that path needs to change:

- **Cloud:** the `.mp3` delivery URL makes Cloudinary extract and transcode the soundtrack, so the browser never receives the picture. The cover is the `fl_waveform` image, not a video frame.
- **Device-only:** the `html-audio` engine plays the Blob through `new Audio()`, which decodes only the audio track of a video container. `probe()` reads the duration the same way.
- Neither path sets `track.provider` to an embed provider, so `#cover` never gets `data-embed` and no video surface is rendered.

So the work is to widen what is accepted, not to build an audio-only playback path.

## 3. Design

Replace the extension whitelist with one "is this audio or video?" test shared by both paths, and let Cloudinary (cloud) or the browser decoder (device-only) be the judge of whether a particular file can actually be read.

### 3.1 One shared test

Rename `isAudioFile(file)` in `local-files.js` to `isMediaFile(file)`, widen it, and use it from `cloud-upload.js` too (`local-files.js` only imports `db.js` and `probe.js`, so there is no import cycle and it stays loadable in the Node unit tests; nothing outside `local-files.js` calls the old name):

- true when `file.type` starts with `audio/` or `video/`;
- otherwise true when the extension is on a broad list of audio and video extensions. This fallback is required, not optional: Windows and some mobile browsers report an empty MIME type for less common formats (`.opus`, `.mka`, `.ape`, `.wv`, `.mkv`, `.flv`, sometimes `.flac`).

Proposed list, kept as one constant (`MEDIA_EXT`, replacing `AUDIO_EXT`):

- audio: `mp3 mp2 mpga m4a m4b aac ogg oga opus wav wave flac aif aiff aifc amr wma mka weba caf ac3 ape wv tta dsf au snd ra mid midi 3ga`
- video: `mp4 m4v mov webm mkv avi wmv flv f4v mpg mpeg mpe m2v ts mts m2ts 3gp 3g2 ogv vob mxf asf`

Read the type as `file.type || ""` so the unit tests can keep passing plain `{ name, size }` objects.

### 3.2 `cloud-upload.js`

- `validate()` becomes: not configured → error; `!isMediaFile(file)` → `"<name>" is not an audio or video file.`; over `maxBytes` → the existing size error.
- Remove `DEFAULT_FORMATS` and the `allowedFormats` default.
- Keep `allowedFormats` as an **optional restriction** for forks: when `config.json` supplies a non-empty array, the extension must also be in it (current message). When it is absent, any audio or video is accepted. This is one extra condition and keeps existing fork configs working.

### 3.3 `config.json`

Delete the `allowedFormats` line so the live site accepts any audio or video. `maxBytes` (100 MB) is unchanged; it is the limit most videos will hit first, and the existing "larger than the 100 MB limit" row with its Keep button already covers that.

### 3.4 `local-files.js`

- `AUDIO_EXT` becomes `MEDIA_EXT`, the broad list from §3.1; `isAudioFile` becomes `isMediaFile`.
- `describe(name)` strips the extension with a generic pattern (`/\.[a-z0-9]{1,5}$/i`) instead of the list, so a file accepted by MIME type alone does not keep its extension in the title.
- `add()` is otherwise unchanged: `probe()` still rejects what the browser cannot decode, and the existing "Skipped N unsupported file(s)" toast covers it.

### 3.5 `index.html`

Widen the `#file` `accept` attribute to `audio/*,video/*` plus the same extension list, so the OS picker does not grey out files with unregistered MIME types. The drop overlay already reads "Drop audio or video files to add them". Add one sentence to the upload dialog's `.consent` paragraph: "Videos are played as audio only."

### 3.6 Playing video as audio

No playback code changes (§2). Three edge cases to handle or accept:

- **Video with no soundtrack.** Cloudinary accepts the upload, but the `.mp3` rendition cannot be produced, so the track fails when first played and goes through the existing error path (`failed`, "can't be played… Skipping it"). Catch it at upload time instead: the upload response describes the file's streams, so `uploadTrack()` can reject with "This video has no audio track." before saving the record when the response reports no audio. The exact response field (`audio` being empty, or `is_audio`) should be confirmed from a real response before coding the check. Device-only: `probe()` succeeds on a silent video, so it would be added and play silence; accepted as is.
- **Cover art.** `fl_waveform` is generated from the soundtrack and works the same for a video upload; if it does not load, `ui.js` already falls back to the coloured letter tile.
- **Storage.** Cloudinary keeps the original video even though only the MP3 rendition is ever played. That is fine for a demo but uses storage credits faster than audio; see the optional console change in §3.8.

### 3.7 What happens to a format nobody can decode

Nothing new is needed; the existing flow already handles it:

- Cloud: Cloudinary answers with an error, `runUploads()` shows its message with "You can keep the file on this device instead." and reveals the Keep button.
- Device-only: `probe()` fails and the row says "This file can't be played in this browser." Browsers decode far fewer containers than Cloudinary (typically MP4/MOV, WebM, Ogg, plus the common audio formats), so AVI, WMV, FLV or MKV will usually work only through the cloud path.

So "any audio or video file" means the browser no longer pre-judges by extension. It cannot mean every file will play: Cloudinary decodes the common audio formats (MP3, AAC/M4A, OGG, Opus, WAV, FLAC, AIFF, AMR) and the common video containers (MP4, MOV, WebM, MKV, AVI, WMV, FLV, MPEG, 3GP), and exotic ones such as MIDI, APE or WMA may still be refused there. The list of what Cloudinary accepts should be confirmed against its current documentation or by a test upload before promising a specific format in the UI or README.

### 3.8 Owner tasks (Cloudinary console, not code)

1. **Required.** Open the `mixtape-unsigned` preset → Upload control → **Allowed formats** and either clear it or widen it to match. Until this is done the code change has no effect for the extra formats on the live site. The upload endpoint is `/video/upload`, so Cloudinary should still refuse non-media files, and the 100 MB preset limit remains the server-side guard against abuse. Clearing the format list does widen what an abuser of the public preset can store, which is the trade-off to accept here.
2. **Optional.** To avoid storing whole videos, give the preset an incoming transformation that converts uploads to an audio format, so only the soundtrack is kept. Unsigned uploads cannot request this from the browser; it has to be set on the preset. `toRecord()` builds the playback URL from `public_id`, so it should keep working, but this changes what `res.secure_url` (stored as `original`) points to and needs a test upload before relying on it.

## 4. Changes

| File | Change |
|---|---|
| `js/local-files.js` | `MEDIA_EXT` (broader, audio + video); null-safe `isMediaFile`; generic extension strip in `describe()`. |
| `js/cloud-upload.js` | `validate()` uses `isMediaFile`; drop `DEFAULT_FORMATS`; `allowedFormats` optional; `uploadTrack()` rejects a video with no audio track (§3.6). |
| `config.json` | Remove `allowedFormats`. |
| `index.html` | Wider `accept` on `#file`; "Videos are played as audio only." in the upload dialog. |
| `README.md`, `CLAUDE.md` | One line each: uploads accept any audio or video and play as audio; `allowedFormats` is an optional restriction. |

No change to `ui.js`, `player.js`, the engines, state, the audit log (`file.mime` is already logged as reported) or the collector. No element ids change.

## 5. Tests

Unit, `tests/unit/cloud-upload.test.js` (update "validate enforces format and size"):

- accepts `song.MP3`, `voice.amr`, `take.aiff`, `clip.mkv`, `old.AVI` with no `type`;
- accepts `{ name: "recording", type: "audio/x-whatever" }` and `{ name: "clip", type: "video/x-matroska" }` (MIME alone, no extension);
- rejects `notes.txt` and `{ name: "photo.png", type: "image/png" }` with "not an audio or video file";
- still rejects an oversize file;
- with `allowedFormats: ["mp3"]` configured, `clip.mkv` is rejected and `song.mp3` passes.

Browser, `tests/upload.spec.js` (Cloudinary stays stubbed):

- upload the tone fixture as a video, `setInputFiles("#file", { name: "clip.mkv", mimeType: "video/x-matroska", buffer })`: no error row, Upload enabled, one request reaches the stub, the track appears with the Cloud badge, its `src` ends in `.mp3`, clicking it plays (`#play` becomes Pause) and `#cover` has an empty `data-embed` (no video surface);
- the stub answers an upload with a response that reports no audio stream: the row shows "no audio track", the Keep button appears and no track is added;
- a `notes.txt` file: error row, Upload disabled, no request sent.

Existing tests keep passing as written; only the unit assertion on the old "not a supported format" message changes.

## 6. Verification

```bash
npm run test:unit
npx playwright test tests/upload.spec.js
npm test
```

After the console change in §3.8, manual checks on the live preset with a real AIFF or AMR file, an MKV or AVI video, and a video with no soundtrack: the first two upload, appear in the playlist and play as audio (the `.mp3` rendition, waveform cover, no picture); the third is refused with the "no audio track" message. Note that `npm run serve` on port 8000 writes to the live audit log unless `audit.endpoint` is blanked locally.

## 7. Out of scope

- The repo track generator (`scripts/generate-tracks.mjs`), which scans `assets/audio/` for `.mp3 .ogg .m4a .wav` only.
- Raising the 100 MB size limit.
- Showing the picture of an uploaded video; uploads are audio-only by design.
- Transcoding in the browser for formats neither Cloudinary nor the browser can decode.
- Direct media links ("Add link"), which are already probed rather than filtered by extension.

---

# Plan: play linked videos as audio only, and keep ads from being heard

## 1. Goal

For a link track that comes from a video service, Mixtape shows no video: the cover slot shows the track's artwork like any other song, and only the audio is heard. Advertisements that the provider inserts are skipped automatically where that is possible, and silenced automatically where it is not.

## 2. Current behaviour

| Provider | Engine | Picture today | Ads today |
|---|---|---|---|
| YouTube | `engines/youtube.js`, IFrame Player API | Shown. `ui.js` lists it in `EMBEDDED`, so `#cover` gets `data-embed="youtube"` and `css/style.css` line 69 stretches `#embed` over the cover slot. | YouTube plays its own pre-roll and mid-roll ads inside the iframe, with sound. |
| Spotify | `engines/spotify.js`, embed iFrame API | Shown (Spotify's own player card, 352 px). | Decided by Spotify and the visitor's account. |
| Vimeo | `engines/vimeo.js` | Already hidden: `#embed` stays 1 px, opacity 0. | None in the embed. |
| SoundCloud | `engines/soundcloud.js` | Already hidden, same way. | Rare in the widget. |
| Direct links, uploads, repo tracks | `engines/html-audio.js` | Never shown (`new Audio()` decodes the soundtrack only). | None. |

So the work is almost entirely about YouTube. Two facts limit what the page can do there:

- **The player is a cross-origin iframe.** Page JavaScript cannot read or click anything inside it. There is no way to press "Skip ad", remove the ad, or block the ad request from `ui.js` or an engine. The IFrame API has no ad events and no skip call.
- **The YouTube API terms forbid both things this plan asks for.** They require the player to stay visible (at least 200 × 200 px, not covered) and forbid blocking or interfering with ads. The header comment in `youtube.js` and `CLAUDE.md` record the visibility rule as a constraint. Going ahead means knowingly dropping it on a public site; the realistic consequence is YouTube refusing to play embeds for the site's origin. This is the owner's call (§8).

## 3. Design

Two phases. Phase 1 is client-only, ships on GitHub Pages, and delivers "no picture" fully and "ads" partly (silenced, not skipped). Phase 2 is the only way to get real ad-free audio, needs a server, and is optional.

### 3.1 Phase 1a: hide the YouTube picture

Keep the iframe where it is and at full size, and put the artwork on top of it, rather than shrinking it to 1 px. A full-size iframe keeps the browser treating it as an on-screen player (hidden or tiny cross-origin frames are the first thing browsers throttle), and it keeps `data-embed="youtube"` on `#cover`, so the existing tests and the 280 px cover rule are untouched.

- `config.json`: new block `"playback": { "hideVideo": true, "muteAds": true }`. Both default to `false` when absent, so forks and the tests (which stub `config.json` to `{}`) keep today's behaviour.
- `app.js` passes `config.playback` to `initUI` and to `player.init`.
- `ui.js` `renderTrack()`: when `hideVideo` is on and the track is YouTube, set `#cover` `data-audio-only=""`.
- `css/style.css`: `.cover[data-audio-only] .embed{opacity:0;pointer-events:none}` and an override so `#cover-img` / `#cover-letter` stay displayed. YouTube tracks already carry a thumbnail in `track.cover` (`url-tracks.js` falls back to `i.ytimg.com/vi/<id>/hqdefault.jpg`).
- `youtube.js` `playerVars`: `controls: 0`, since the controls can no longer be reached. Mixtape's own play, seek and volume controls already drive the player through the API.

**Tap-to-start fallback.** Mobile browsers may refuse `playVideo()` when the tap happened on Mixtape's button instead of inside the iframe. Today the visitor can tap the visible player; hidden, they would be stuck. So: if a play request has not produced a `PLAYING` state within 4 s, the engine calls `handlers.onBlocked()` plus a new `handlers.onReveal(true)`; `player.js` mirrors it into a new state field `reveal`, and `ui.js` drops `data-audio-only` while it is set, showing the player with a toast "Tap the player to start". The first `PLAYING` event clears it and the artwork returns.

Spotify stays visible. Its card is not a video, its volume control exists only inside the embed (`#vol-hint`), and logging in happens there.

### 3.2 Phase 1b: silence YouTube ads

Since an ad cannot be skipped from outside the iframe, detect it and mute it.

- **Detection (must be confirmed by the spike in §4 step 1).** Candidates, all readable through the API: `player.getVideoData().video_id` differs from `track.externalId`; `getDuration()` differs from the content duration by more than a few seconds; the player state stays `UNSTARTED` (-1) or `BUFFERING` while audio is audible. The engine keeps an `inAd` flag from whichever signal proves reliable, checked in the existing 250 ms poll and in `onStateChange`.
- **While `inAd`:** call `player.mute()` regardless of the user's volume; do not forward `onTime` / `onDuration` (so the seek bar does not jump and the audit log's listening time and `play_end` position are not polluted by ad time); report `handlers.onAd(true)`, mirrored into state as `ad`, and `ui.js` shows a hint next to `#preview-hint`: "Ad playing (muted)".
- **When the ad ends:** restore the user's volume and mute setting through the existing `applyVolume()`, clear `ad`, resume forwarding time.
- **If no signal is reliable:** fall back to muting from `load()` until the first `PLAYING` state whose `getCurrentTime()` is advancing on the right video. This covers pre-rolls only; mid-rolls would be heard.
- **Skippable ads.** The hint gets a "Show player" button that sets `reveal`, so the visitor can click YouTube's own Skip button; the artwork returns when the ad ends. Unskippable ads are waited out in silence.

What this does not do: the ad still loads and still takes its time. It is muted, not blocked. That is the ceiling for client-side code.

### 3.3 Phase 2 (optional): a resolver, for true ad-free audio

The only way to hear a YouTube track with no ad and no video at all is to not use the embed: a server finds the video's audio-only stream and the existing `html-audio` engine plays it as a direct URL.

- A separate deployment (`resolver/`, like `collector/`), never imported by the site; `config.json` gets `playback.resolver: "<url>"`. When it is set, `player.js` `providerOf()` routes YouTube tracks to `html-audio` with `src = <resolver>/v1/audio?id=<externalId>`; when the resolver fails, it falls back to the embed engine from Phase 1.
- It cannot be a plain Cloudflare Worker. Finding the stream needs `yt-dlp` or equivalent (signature deciphering changes often), and stream URLs are tied to the requesting IP and expire, so the server must also proxy the audio bytes with Range support. That means a small VPS or container, real bandwidth, and regular breakage whenever YouTube changes its player.
- This is extraction of content from YouTube, which its terms prohibit outright, and on a public site it invites blocking of the server's IP and complaints to the host. Recommendation: do not build it for the live site. If it is wanted for personal use, run it privately and point a local `config.json` at it.

SoundCloud, Vimeo and Spotify are not covered: the first two have no ad problem worth solving, and Spotify streams are DRM-protected.

## 4. Changes (Phase 1)

Steps in order:

1. **Spike, no commit.** With `npm run serve` (audit endpoint blanked locally), play two or three monetised YouTube videos and log `getPlayerState()`, `getVideoData()`, `getDuration()` and `getCurrentTime()` every 250 ms through a pre-roll and a mid-roll. Also try the hidden player on Android Chrome and iOS Safari. Pick the detection signal and confirm whether the tap-to-start fallback is needed. If no signal works, Phase 1b shrinks to the pre-roll fallback.
2. Implement:

| File | Change |
|---|---|
| `config.json` | Add `playback.hideVideo` and `playback.muteAds`. |
| `js/app.js` | Pass `config.playback` to `initUI` and `player.init`. |
| `js/state.js` | New fields `ad: false`, `reveal: false`. |
| `js/player.js` | `onAd` and `onReveal` handlers in `make()`; reset both in `sync()` on track change; pass options to the YouTube factory. |
| `js/engines/youtube.js` | `controls: 0` when hidden; `inAd` detection, mute and restore; suppress time during ads; play-request timeout calling `onBlocked` / `onReveal`. Update the header comment. |
| `js/ui.js` | `data-audio-only` on `#cover`; ad hint with "Show player"; honour `state.reveal`. |
| `css/style.css` | The `data-audio-only` rules. |
| `index.html` | `#ad-hint` element; adjust the YouTube wording in the page copy. |
| `README.md`, `CLAUDE.md` | YouTube is audio-only with muted ads when `playback` is set; replace the "must stay visible" statement with the decision from §8; `onAd` / `onReveal` in the engine handler list. |

No change to `url-tracks.js`, `playlist.js`, the other engines or the collector. `audit.js` needs nothing as long as ad time is not forwarded; no new event is logged.

## 5. Tests

`tests/links.spec.js`, extending the fake `window.YT` (it already has `getDuration()` and `PlayerState`); add `getVideoData()`, `mute()` / `unMute()` recording, and a way to put the fake into an "ad" state:

- with `config.json` stubbed to `{ playback: { hideVideo: true } }`: a YouTube track gives `#cover` both `data-embed="youtube"` and `data-audio-only`, `#cover-img` is visible, and `#embed` has opacity 0;
- with `{}`: no `data-audio-only` (today's behaviour, existing assertions unchanged);
- with `muteAds`: the fake enters the ad state → `mute()` was called, `#ad-hint` is visible, the seek bar does not move; the ad ends → the user's mute setting is restored and the hint is hidden;
- "Show player" removes `data-audio-only` until the ad ends;
- the fake never reaches `PLAYING` after a play request → `#play` returns to Play and the player is revealed.

The 320 px smoke test and the Spotify tests must pass unchanged.

## 6. Verification

```bash
npm run test:unit
npx playwright test tests/links.spec.js
npm test
```

In PowerShell, when port 8000 is taken: `$env:PORT = 8010; npx playwright test tests/links.spec.js`.

Manual, on the real YouTube player (the tests only see a fake): a monetised video with a pre-roll, one long enough for a mid-roll, a video with embedding disabled (existing error path), and the same on a phone. Check that nothing is heard during ads, the volume comes back afterwards, the seek bar and time are right after an ad, and the next track starts when the video ends.

## 7. Out of scope

- Blocking ad requests or skipping ads from page code: not possible across the iframe boundary.
- Hiding the Spotify player or doing anything about Spotify ads.
- A browser extension or user-script, which could skip ads but is not part of the site.
- Phase 2, unless the owner opts in (§8).

## 8. Decisions needed from the owner before coding

1. **Accept the YouTube terms conflict?** Hiding the player and muting ads both break the YouTube API terms on a public site. If not accepted, the compliant version of this plan is: leave YouTube as it is, and recommend direct links or uploads for ad-free, picture-free playback, which already works.
2. **Phase 2 resolver:** recommended no for the live site (§3.3).

## 9. Status

The owner chose to go ahead with both phases. Both are implemented and covered by tests against fakes; neither has been run against the real YouTube.

| Part | State |
|---|---|
| Phase 1a, hide the picture | Done as designed. `playback.hideVideo` is `true` in `config.json`. |
| Phase 1b, mute ads | Done. `playback.muteAds` is `true`. The engine mutes while playback is wanted and the player reports `UNSTARTED` (-1) or a video id other than the track's. The `getDuration()` signal was dropped: YouTube tracks have no stored duration to compare with. |
| Phase 2, resolver | Done: `resolver/` plus the routing and fallback in `player.js`. `playback.resolver` is set to `http://127.0.0.1:8790` in the working copy for local use; whether to commit it is the owner's decision. |

Differences from the text above:

- **§4 step 1, the spike, was not done.** It needs real monetised videos and phones. The two ad signals are therefore unconfirmed; if YouTube reports neither during an ad, the ad is heard as before.
- **§3.1 tap-to-start:** on the 4 s timeout the engine calls `onReveal` only, not `onBlocked`. A long pre-roll looks the same as a blocked start, and marking it paused would stop the next track from starting on its own. So `#play` keeps showing Pause while the player is revealed.
- **§3.2 listening time:** the audit log measures wall-clock time while `state.playing` is true, so time spent in a muted ad still counts towards the track. Only the position is kept clean.
- **§3.3:** checked by hand on 2026-11-17 with a real `yt-dlp`: several videos played and seeked in Edge through the resolver with no embed loaded. YouTube refuses a new stream URL for about 5 s, so the server waits for the URL's `available_at` time; a first play takes 10 to 15 s.

Still to do by hand (§6): play monetised videos with a pre-roll and a mid-roll on desktop, Android Chrome and iOS Safari, on the embed path (resolver off or failing).
