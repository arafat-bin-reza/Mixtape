# Mixtape resolver

A small Node server that lets Mixtape play a YouTube link as plain audio: no embedded player, no video and no ads. It asks [yt-dlp](https://github.com/yt-dlp/yt-dlp) for the video's audio-only stream and proxies the bytes to the browser.

**Read this first.** Extracting streams this way is prohibited by YouTube's terms of service. Run it privately for your own use. Putting it behind the public site invites YouTube blocking the server's IP address and complaints to whoever hosts it, and you pay for every byte that every visitor plays. The site works without it: when `playback.resolver` is not set, or the resolver fails for a track, Mixtape uses the normal YouTube embed.

## Run

Requirements: Node 20 or later, and `yt-dlp` on the `PATH` (or its full path in `YTDLP_PATH`). It has no npm dependencies. On Windows, `winget install yt-dlp.yt-dlp` installs it together with the Deno runtime and ffmpeg it uses; open a new terminal afterwards so the updated `PATH` is picked up.

```bash
cd resolver
npm start            # http://127.0.0.1:8790
```

Then point a **local** copy of `config.json` at it (do not commit this unless you mean to use it on the live site):

```json
"playback": { "hideVideo": true, "muteAds": true, "resolver": "http://127.0.0.1:8790" }
```

Check it: `curl -I "http://127.0.0.1:8790/v1/audio?id=<11-character video id>"` should answer `200` with `Content-Type: audio/mp4` after about ten seconds. The first request for a video is slow for two reasons: `yt-dlp` needs a few seconds to find the stream, and YouTube refuses a newly issued stream URL for about five seconds more, so the server waits before using it. Later requests for the same video (seeking, replaying) are answered at once until the URL expires, a few hours later.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8790` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. Only this machine can reach it by default. |
| `ALLOWED_ORIGINS` | empty (any) | Comma-separated origins, e.g. `https://arafat-bin-reza.github.io,http://localhost:8000`. When set, a request must carry a matching `Origin` or `Referer`. Both can be forged, so this only stops other websites using your server, not a determined person. |
| `MAX_STREAMS` | `8` | Concurrent streams before answering `503`. |
| `YTDLP_PATH` | `yt-dlp` | The yt-dlp executable. |

## Using it from the live site

The live site is HTTPS, so the browser will only load audio from an HTTPS resolver (or from `localhost` on the visitor's own machine). To serve other devices you need a host that can run `yt-dlp` (a VPS or container, not a Cloudflare Worker), a reverse proxy with a certificate in front of it, `HOST=0.0.0.0`, and `ALLOWED_ORIGINS` set. Stream URLs are tied to the IP address that asked for them, which is why the server proxies the audio instead of redirecting to it.

## Routes

- `GET /v1/audio?id=<id>`: the audio stream. `Range` is passed through, so seeking works. `400` for a malformed id, `403` for a disallowed origin, `502` when the video cannot be resolved, `503` when busy.
- `GET /healthz`: `ok`.

## Maintenance

YouTube changes its player often and `yt-dlp` follows; when tracks start falling back to the embed, update it (`yt-dlp -U`). Lookups are cached in memory until the stream URL's own expiry, and a refused stream is looked up again once.
