# Mixtape audit collector

A Cloudflare Worker with a D1 database that receives the usage log from the Mixtape web app (design: `../plan.md`, Part D).
It has its own `package.json`; nothing here is loaded by the site.

- `POST /v1/events` is public. It accepts batches only from the origins in `ALLOWED_ORIGINS`, validates and truncates every field, rate-limits per IP, and records the sender's IP and Cloudflare location itself.
- `/v1/admin/*` needs `Authorization: Bearer <ADMIN_TOKEN>`. The token is a Worker secret and is never written to this repository.
- A daily cron deletes sessions and events older than `RETENTION_DAYS` and clears the IP and visitor id on catalogue rows of that age.

## Deploy

```bash
cd collector
npm install
npx wrangler login                        # opens the browser; approve access
npx wrangler d1 create mixtape-audit      # copy the printed database_id into wrangler.toml
npm run schema:remote                     # creates the tables
npx wrangler secret put ADMIN_TOKEN       # paste a long random string; keep a copy somewhere safe
npm run deploy                            # prints https://mixtape-audit.<subdomain>.workers.dev
```

Then set `audit.endpoint` in `../config.json` to `https://mixtape-audit.<subdomain>.workers.dev/v1/events` and push. The current deployment is `https://mixtape-audit.mixtape-audit-collector.workers.dev`. An empty endpoint turns logging off.

If the site moves to another address, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and deploy again.

## Run locally

```bash
npm run schema:local
npx wrangler dev --port 8787 --var ADMIN_TOKEN:localtest
```

Requests from `http://localhost:8000` are accepted, so `npm run serve` in the repository root with `audit.endpoint` set to `http://localhost:8787/v1/events` logs to the local database.

## Read the log

```bash
TOKEN=...   # the ADMIN_TOKEN value
BASE=https://mixtape-audit.<subdomain>.workers.dev/v1/admin

curl -H "Authorization: Bearer $TOKEN" "$BASE/sessions?from=2026-11-01&to=2026-11-30&format=csv" -o sessions.csv
curl -H "Authorization: Bearer $TOKEN" "$BASE/events?ip=203.0.113.7"
curl -H "Authorization: Bearer $TOKEN" "$BASE/events?visitor=<visitor id>&format=csv"
curl -H "Authorization: Bearer $TOKEN" "$BASE/events?track=<track id>&type=play_start"
curl -H "Authorization: Bearer $TOKEN" "$BASE/tracks?format=csv" -o tracks.csv
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/visitors/<visitor id>"    # erasure request
```

Filters: `from`, `to` (date or milliseconds), `ip`, `visitor`, `limit` (default 500, max 5000) everywhere; `track`, `session`, `type` on events; `track`, `provider` on tracks. Every `*_at` column has a readable `*_utc` twin.

## Saved queries

Run in the D1 console in the Cloudflare dashboard, or with `npx wrangler d1 execute mixtape-audit --remote --command "<sql>"`.

Visitors in a period, with IP, location, device, sessions and listening time:

```sql
SELECT s.visitor_id, s.ip, s.country, s.city, s.browser, s.os, s.device_type, s.device_model,
       COUNT(DISTINCT s.id) AS sessions, ROUND(COALESCE(SUM(e.listened_sec), 0)) AS listened_sec,
       datetime(MIN(s.started_at) / 1000, 'unixepoch') AS first_seen, datetime(MAX(s.last_seen_at) / 1000, 'unixepoch') AS last_seen
FROM sessions s LEFT JOIN events e ON e.session_id = s.id AND e.type = 'play_end'
WHERE s.started_at >= unixepoch('2026-11-01') * 1000 AND s.started_at < unixepoch('2026-12-01') * 1000
GROUP BY s.visitor_id, s.ip ORDER BY last_seen DESC;
```

Everything one IP address (or visitor id) did, in order:

```sql
SELECT datetime(e.received_at / 1000, 'unixepoch') AS at, e.visitor_id, e.type, e.track_id, t.title, t.url, e.listened_sec, e.reason
FROM events e LEFT JOIN tracks t ON t.track_id = e.track_id
WHERE e.ip = '203.0.113.7'            -- or: e.visitor_id = '<visitor id>'
ORDER BY e.received_at, e.seq;
```

All links added, newest first, with who added them and from where:

```sql
SELECT datetime(e.received_at / 1000, 'unixepoch') AS at, t.provider, t.title, t.artist, t.url, t.file_name,
       e.visitor_id, e.ip, s.country, s.city, s.browser, s.os
FROM events e JOIN tracks t ON t.track_id = e.track_id LEFT JOIN sessions s ON s.id = e.session_id
WHERE e.type = 'track_add' ORDER BY e.received_at DESC;
```

Most played tracks:

```sql
SELECT title, artist, provider, url, play_count, add_count, ROUND(listened_sec) AS listened_sec
FROM tracks ORDER BY play_count DESC, listened_sec DESC LIMIT 50;
```

Who played a given track:

```sql
SELECT datetime(e.received_at / 1000, 'unixepoch') AS at, e.visitor_id, e.ip, s.country, s.city, s.device_type, e.listened_sec, e.reason
FROM events e LEFT JOIN sessions s ON s.id = e.session_id
WHERE e.track_id = '<track id>' AND e.type = 'play_end' ORDER BY e.received_at DESC;
```

## Notes

- The log is best effort: content blockers can stop the request, and anyone can post invented events to a public endpoint. The IP column is always the real sender's.
- Retried batches are harmless: `UNIQUE (session_id, seq)` ignores events already stored, and counters only move for newly stored events.
- If D1 rejects a write the Worker still answers `204`, so the app is never affected; the error is in the Worker logs (`npx wrangler tail`).
