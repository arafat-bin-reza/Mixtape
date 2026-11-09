# Mixtape - Business Document

Last updated: 2026-11-09. Reflects the codebase at commit `4d0e7d5` (Spotify playback and responsive layout).

## 1. Overview

Mixtape is a lightweight, browser-based music player with a built-in playlist. It is published as a static website on GitHub Pages and requires no account, no installation, and no backend server of its own. Visitors can:

- listen to a curated set of demo tracks shipped with the site;
- **add their own audio or video files**, which are uploaded to Mixtape's cloud storage (Cloudinary) and played back as audio from a permanent URL on any device;
- **paste a link** to a track hosted elsewhere (a direct audio/video URL, or a SoundCloud, YouTube, Vimeo or Spotify link) and play it inside the same playlist.

The project is open source under the MIT License (copyright 2026, Arafat Bin Reza) and is hosted at `https://github.com/arafat-bin-reza/Mixtape`.

## 2. Purpose and Value Proposition

| Problem | How Mixtape addresses it |
|---|---|
| Streaming services require sign-up, subscriptions, and an app for every play. | Mixtape runs entirely in the browser. One URL, no account, works on phones, tablets and desktops. |
| A personal collection is scattered across devices, drives and platforms. | One playlist mixes repository tracks, the listener's own uploads, and links from four platforms. Uploads live in the cloud, so the same track plays from another device by URL. |
| Sharing a small collection (demos, OSTs, a band's releases) usually means pointing people at a third-party platform. | A repository owner drops audio files into a folder and the site updates itself. Optionally, a public playlist of uploads can be enabled with no database. |
| Heavy web apps load slowly on low-end devices and poor connections. | The player is a handful of small files with no framework and no build step. Third-party player scripts load only when a track from that platform is played. |

## 3. Target Users

- **Independent artists and small labels** who want a simple, branded page to showcase a few tracks without a streaming-platform intermediary.
- **Content creators and OST curators** who want to share a themed collection (the current demo tracks are Pakistani drama OSTs) and mix in links from YouTube, SoundCloud, Vimeo or Spotify.
- **Listeners with a personal library** who want one place to play their own files and favourite links across devices.
- **Developers and learners** looking for a clean, dependency-free example of a modern web audio application with pluggable playback engines.

## 4. Current Product Scope

### What the product does today

- Plays the repository's demo tracks (currently two: *Alvida Alvida* by Nabeel Shaukat Ali and *Majboor* by Sheheryar Rehan x Zoha Waseem).
- **Add files**: uploads audio or video (MP3, M4A, AAC, OGG, Opus, WAV, FLAC, MP4, WebM, MOV; up to 100 MB each) to Cloudinary with an editable title and artist, shows progress, and plays the result as audio. If the upload fails or the device is offline, the listener can keep the file on the device only (browser storage). A fork with no Cloudinary account falls back to device-only storage automatically.
- **Add link** (or paste anywhere on the page): plays direct audio/video URLs natively, and SoundCloud, YouTube, Vimeo and Spotify tracks through each platform's official embedded player. Title, artwork and (where offered) duration are fetched automatically and remain editable. Duplicate links are detected. Facebook, Instagram, TikTok and X links are declined with an explanation.
- **Spotify specifics**: plays through Spotify's own embedded player, so the listener hears the full track when logged in to Spotify in that browser and a 30-second preview otherwise. Albums and playlists are not supported yet; single tracks and podcast episodes are.
- Standard playback controls: play/pause, previous/next, seek, volume, mute, shuffle, and three repeat modes (off, all, one). Tracks that fail to play are skipped with an explanation.
- Remembers volume, shuffle, repeat mode, theme, last-played track, and every added upload or link between visits on the same browser.
- Light and dark themes, keyboard shortcuts, and lock-screen / headset / media-key integration through the Media Session API.
- Responsive layout from 320 px phones to large desktops; accessible by design (screen-reader labels, live announcements, visible focus states).

### What the product deliberately does not do

- No user accounts, social features, comments, or likes.
- No server code of its own. Cloud storage and link playback use third-party services directly from the browser.
- No deletion of uploads from the browser: removing a cloud track hides it from the listener's playlist; the file itself is removed by the owner in the Cloudinary console.
- No payment, licensing, or rights-management features.
- No analytics or tracking of listeners by Mixtape itself (the embedded players and Cloudinary apply their own terms).

## 5. Operating Model

The project runs at near-zero cost on free tiers:

| Function | How it is handled | Cost |
|---|---|---|
| Hosting | GitHub Pages serves the static site from the `main` branch. | Free |
| Content updates | Adding an audio file to the repository triggers a GitHub Action that regenerates the track list and commits it. | Free (GitHub Actions minutes) |
| Listener uploads | Cloudinary, cloud `tivkdskh`, via an unsigned upload preset. Audio is transcoded to MP3 on delivery; waveform artwork is generated on the fly. | Free plan: about 25 credits/month (1 credit = 1 GB storage, 1 GB bandwidth, or 1,000 transformations). Every stream of an uploaded track consumes bandwidth credits. |
| Link playback | YouTube, SoundCloud, Vimeo and Spotify embedded players, plus their public oEmbed endpoints. No API keys, no registration, no quota. | Free |
| Maintenance | Plain HTML/CSS/JavaScript with two development-only dependencies; unit and browser tests run locally and could run in CI. | Minimal developer time |

Two operational constraints:

1. **Repository size.** The two demo tracks are uncompressed WAV files totalling roughly 74 MB. The README recommends keeping repository audio to a few small tracks; the technical plan lists moving them to Cloudinary as a follow-up.
2. **Cloudinary credits.** Storage and streaming of listener uploads count against the free plan. Usage should be checked in the Cloudinary console periodically; popularity would force either a paid plan or a cap on uploads.

## 6. Stakeholders

| Stakeholder | Interest |
|---|---|
| Repository owner (Arafat Bin Reza) | Curates the demo playlist, maintains the code, owns deployment, owns the Cloudinary account and is the only party who can delete uploads or enable the public playlist. |
| Listeners | Fast playback of curated tracks, their own uploads, and links, on any device. |
| Uploaders | Their files are stored on a third-party service under Mixtape's account; they consent to this in the upload dialog and must have the right to share what they upload. |
| Rights holders | Demo tracks and uploads must be licensed or owned. The README provides a takedown route (open an issue) and the owner can remove files from Cloudinary. |
| Platform providers (Cloudinary, YouTube, SoundCloud, Vimeo, Spotify) | Their terms govern usage: unsigned-upload limits, visible players for YouTube and Spotify, no audio extraction, and Spotify's preview-only playback for logged-out visitors. |
| Contributors | Clear, minimal codebase and a documented engine interface lower the barrier to adding a provider. |

## 7. Risks and Considerations

1. **Content rights of demo tracks.** The current demo tracks are commercial drama soundtracks. Distributing them from a public repository without a licence is a legal exposure. Either replace them with owned or public-domain audio, or obtain permission and document it.
2. **User uploads and copyright.** Anyone can upload to the account. Mitigations in place: consent text in the dialog, a takedown route in the README, owner deletion in the console, and the public playlist kept off by default (uploads are visible only to the uploader unless the owner enables Cloudinary's resource list and tags items).
3. **Unsigned upload abuse.** The upload preset name is public by design. A bad actor could consume credits or store unwanted content. Mitigations: preset limits on formats, size and folder; usage alerts; the owner can rotate or disable the preset. The long-term fix is signed uploads through a small serverless function (technical plan, section 17).
4. **Dependence on third-party players.** Link playback stops if a platform changes its embed API or blocks a track (private, region-locked, embedding disabled). Mixtape degrades gracefully by skipping the track, but cannot fix it.
5. **Spotify expectation gap.** Logged-out visitors hear 30-second previews and may think the player is broken. The UI labels previews and links to Spotify login; full-length, audio-only Spotify playback would require Spotify's Web Playback SDK, which is restricted to Premium listeners and to registered apps with a small user allow-list, so it is not planned.
6. **Repository bloat.** Each WAV track adds tens of megabytes to every clone permanently.
7. **Single-maintainer dependency.** Curation, deployment, Cloudinary administration and takedowns all flow through one person.
8. **Browser storage fallback.** Device-only tracks (used when an upload fails) can be cleared by the browser; the app warns about this.

## 8. Opportunities

Short-term, low-cost options that build on the existing design:

- **Branded artist pages.** Fork the repository per artist or collection and customise the title, theme colour, and track list. Each fork is a free, independent site, with or without its own Cloudinary account.
- **Public community playlist.** Enabling Cloudinary's resource list turns owner-tagged uploads into a shared playlist for every visitor, with no database.
- **Signed uploads and deletion.** A small serverless function holding the Cloudinary secret would allow per-user deletion, rate limiting, or a private upload passphrase, and could also fetch richer Spotify metadata (artist, album, duration).
- **Move demo tracks to Cloudinary.** Removes 74 MB from the repository and gives the demo tracks the same transcoded MP3 delivery as uploads.
- **Installable app.** A web app manifest and service worker would let listeners install Mixtape to their home screen and play repository tracks offline.
- **Playlists and sharing.** Named playlists shared by URL; expanding a Spotify or SoundCloud album link into rows.

Longer-term, if the project were to become a product rather than a personal site, the natural extensions are accounts with private libraries, multi-user curation, and a hosted "create your own Mixtape page" service. Each introduces infrastructure cost and content-moderation responsibilities that the current model mostly avoids.

## 9. Summary

Mixtape has grown from a demo-track player into a working, near-zero-cost personal and shared music hub: repository tracks, cloud-stored uploads, and links from four major platforms in one playlist that works on any device. Its strengths are simplicity, the automated content pipeline, and the absence of any server to run. Its immediate business needs are to resolve the licensing status of the demo tracks, keep an eye on Cloudinary usage and upload abuse, and control repository size. Beyond that, it is a solid foundation for branded artist pages, a community playlist, or an installable offline player.
