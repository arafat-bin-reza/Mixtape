# Mixtape - Business Document

## 1. Overview

Mixtape is a lightweight, browser-based music player with a built-in playlist. It is published as a static website on GitHub Pages and requires no account, no installation, and no backend server. Visitors can listen to a curated set of demo tracks shipped with the site, and can also add audio files from their own device. Those personal files stay in the visitor's browser and are never uploaded anywhere.

The project is open source under the MIT License (copyright 2026, Arafat Bin Reza) and is hosted at `https://github.com/arafat-bin-reza/Mixtape`.

## 2. Purpose and Value Proposition

| Problem | How Mixtape addresses it |
|---|---|
| Streaming services require sign-up, subscriptions, and an internet connection for every play. | Mixtape runs entirely in the browser. Once the page is loaded, playback of local files works offline. |
| Uploading personal music to a cloud service raises privacy and copyright concerns. | Files added by the user are stored only in the browser's local database (IndexedDB). Nothing leaves the device. |
| Sharing a small collection of tracks (demos, OSTs, a band's releases) usually means linking to third-party platforms. | A repository owner can drop audio files into a folder and the site updates itself automatically. One URL hosts the whole collection. |
| Heavy web apps load slowly on low-end devices and poor connections. | The player is a handful of small files with no framework and no build step. It loads fast and works on phones and desktops. |

## 3. Target Users

- **Independent artists and small labels** who want a simple, branded page to showcase a few tracks without a streaming-platform intermediary.
- **Content creators and OST curators** who want to share a themed collection (the current demo tracks are Pakistani drama OSTs).
- **Privacy-conscious listeners** who want to play their own files in a browser without uploading them.
- **Developers and learners** looking for a clean, dependency-free example of a modern web audio application.

## 4. Current Product Scope

### What the product does today

- Plays the repository's demo tracks (currently two: *Alvida Alvida* by Nabeel Shaukat Ali and *Majboor* by Sheheryar Rehan x Zoha Waseem).
- Lets visitors add their own audio files via a file picker or drag-and-drop. Supported formats include MP3, M4A, AAC, OGG, Opus, WAV, and FLAC. Added files persist across reloads in the same browser.
- Standard playback controls: play/pause, previous/next, seek, volume, mute, shuffle, and three repeat modes (off, all, one).
- Remembers the listener's volume, shuffle, repeat mode, theme, and last-played track between visits.
- Light and dark themes, following the operating system preference by default with a manual override.
- Keyboard shortcuts for all core actions.
- Integration with the operating system's media controls (lock screen, headset buttons, keyboard media keys) through the Media Session API.
- Accessible by design: screen-reader labels, live announcements of the current track, and visible focus states.
- Gracefully skips tracks that fail to play and tells the user why.

### What the product deliberately does not do

- No user accounts, social features, comments, or likes.
- No server-side storage or streaming infrastructure. Repository audio is served as static files.
- No payment, licensing, or rights-management features.
- No analytics or tracking of listeners.

## 5. Operating Model

The project runs at effectively zero cost:

| Function | How it is handled | Cost |
|---|---|---|
| Hosting | GitHub Pages serves the static site from the `main` branch. | Free |
| Content updates | Adding an audio file to the repository triggers a GitHub Action that regenerates the track list and commits it. No manual data entry. | Free (GitHub Actions minutes) |
| Storage of listener files | The listener's own browser. | None to the project |
| Maintenance | Plain HTML/CSS/JavaScript with two development-only dependencies. | Minimal developer time |

The main operational constraint is repository size. GitHub Pages and repositories work best under about 1 GB, and the two current demo tracks are uncompressed WAV files totalling roughly 74 MB. The README already recommends keeping repository audio to a few small demo tracks and hosting larger libraries elsewhere by URL.

## 6. Stakeholders

| Stakeholder | Interest |
|---|---|
| Repository owner (Arafat Bin Reza) | Curates the demo playlist, maintains the code, owns deployment. |
| Listeners | Fast, private playback of curated and personal tracks. |
| Rights holders of demo tracks | Tracks included in the repository must be properly licensed or owned. The README states that demo tracks are public domain; the current playlist contains commercial OSTs, so this statement should be reviewed. |
| Contributors | Clear, minimal codebase lowers the barrier to contributing. |

## 7. Risks and Considerations

1. **Content rights.** The current demo tracks are commercial drama soundtracks. Distributing them from a public repository without a licence is a legal exposure. Either replace them with owned or public-domain audio, or obtain permission and document it.
2. **Repository bloat.** Each WAV track adds tens of megabytes to every clone and to Git history permanently. Converting demo audio to MP3 or AAC and keeping it under a few MB per track would reduce this sharply.
3. **Browser storage limits.** Listener-added files live in browser storage, which browsers may clear under pressure or in private mode. The app warns users when this happens but cannot prevent it.
4. **Single-maintainer dependency.** All curation and deployment currently flows through one person.

## 8. Opportunities

Short-term, low-cost options that build on the existing design:

- **Branded artist pages.** Fork the repository per artist or collection and customise the title, theme colour, and track list. Each fork is a free, independent site.
- **External audio hosting.** Point `data/tracks.json` at tracks hosted on a CDN or object storage so the repository stays small and the catalogue can grow.
- **Installable app.** Add a web app manifest and service worker so listeners can install Mixtape to their home screen and play the demo tracks offline.
- **Playlists and sharing.** Allow listeners to save named playlists and share them by URL.
- **Lyrics, artwork, and metadata.** The generator already extracts embedded cover art; richer metadata (album, year, lyrics) would improve the showcase value for artists.

Longer-term, if the project were to become a product rather than a personal site, the natural extensions are optional cloud sync of personal libraries, multi-user curation, and a hosted "create your own Mixtape page" service. Each of these introduces infrastructure cost and content-moderation responsibilities that the current zero-cost model avoids.

## 9. Summary

Mixtape is a complete, working, zero-cost music showcase and personal player. Its strengths are simplicity, privacy, and the automated content pipeline. Its immediate business needs are to resolve the licensing status of the demo tracks and to control repository size. Beyond that, it is a solid foundation for branded artist pages or an installable offline player.
