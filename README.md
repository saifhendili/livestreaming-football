# Kickoff Live

A MERN app that lists today's football matches and plays their live streams in a clean player, with none of the source site's ads.

It reads match listings and stream servers from [fast-shot.com](https://fast-shot.com/). When you open a match, the server works out the real stream link for each server and the app plays it in its own player.

- **M**ongoDB: stores scraped matches and cached stream links
- **E**xpress: scrapes the source and serves a small JSON API
- **R**eact (Vite): match list, watch page, hls.js player
- **N**ode 20+ (developed on Node 24)

## Run it

```bash
npm install
npm run db      # starts MongoDB in Docker on 127.0.0.1:27020
npm run dev     # API on :5050, web app on :5173 (or the next free port)
```

Open the URL Vite prints.

Production: `npm run build && npm start` serves the built React app and the API together on http://localhost:5050.

Optional settings go in `server/.env` (see `server/.env.example`). Run the tests with `npm test`.

## How the "no ads" part works

The source site's player pages are wrappers around a plain stream URL plus a lot of ad scripts. This app never loads those pages in your browser. The server fetches them, reads the stream URL out of the HTML (it never runs the page's scripts), and the React app plays that URL directly with hls.js.

| Server type | What you get |
|---|---|
| **Ad-free** (direct HLS) | Plays in the app's own player. No ad code is loaded. |
| **May show ads** (embed) | Third-party players that can't be unwrapped. Shown in a sandboxed iframe with popups and redirects blocked, and listed after the ad-free servers. |
| **External player** | A direct stream whose host refuses other websites. It can't play in a browser, but the link is shown so you can copy it into VLC or mpv. |

Before showing a server, the API checks that each HLS stream is online and whether a browser on another origin could load it. Dead streams are dropped. If a stream fails while you watch, the player moves on to the next ad-free server.

Each stream's link is shown under the player with a copy button.

## API

| Endpoint | Description |
|---|---|
| `GET /api/matches?day=today\|yesterday\|tomorrow\|all&status=live\|upcoming\|finished&q=` | Match list. Re-scrapes the source if the data is older than 60s. |
| `GET /api/matches/:id` | One match. |
| `GET /api/matches/:id/streams[?refresh=1]` | Stream servers for a match, resolved on demand and cached for 2 minutes. |

## Layout

```
server/src/
  services/listing.js   parses a day's match list (pure, tested)
  services/streams.js   finds the real stream URLs behind a match
  services/matches.js   scrape + MongoDB upsert + caching
  services/http.js      fetch with SSRF protection and manifest probing
  routes/ models/ app.js index.js
server/test/            fixtures taken from the real pages + node:test suites
client/src/
  pages/Home.jsx        day tabs, status chips, search, grouped by league
  pages/Watch.jsx       server picker, auto-fallback, stream link
  components/           HlsPlayer, MatchCard, StreamLink
```

## Good to know

- **Streams belong to channels, not matches.** The source maps each match to a channel (for example beIN 1). A server can occasionally show a different match than the one you opened, and finished matches show whatever the channel is airing now. That comes from the source.
- **Logos burned into the video** (broadcaster or re-streamer watermarks) are part of the stream and can't be removed.
- **If the source changes its HTML**, `listing.test.js` and `streams.test.js` are where to look first. The parsers are small and isolated on purpose.
- Kick-off times are published in Egypt time and shown in your local time.
- The streams are third-party re-broadcasts of content owned by others. This app doesn't host or store any video; make sure using them is permitted where you live.
