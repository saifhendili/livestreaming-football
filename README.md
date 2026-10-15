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

## TV channels

The **TV channels** tab (`/tv`) has three collections. Each is its own list with its own data, filters and page (`/tv/world`, `/tv/more`, `/tv/free-tv`), so the same channel can appear in more than one.

| Collection | Where it comes from | What it has |
|---|---|---|
| **Worldwide** (`world`) | The channel entries of the open [iptv-org](https://github.com/iptv-org/iptv) catalogue | About 10,000 channels with logos, filtered by country and category. Closed and adult channels are left out. |
| **More channels** (`more`) | iptv-org streams that belong to no channel entry | About 1,500 titles, mostly free streaming-service channels. Search only: they have no country, category or logo. Streams of the same title are merged. |
| **Free-TV** (`free-tv`) | The [Free-TV/IPTV](https://github.com/Free-TV/IPTV) playlist | About 1,800 hand-picked free channels, filtered by country or topic. Video-on-demand groups are left out. Its YouTube and Twitch entries open on their own site. |

The server downloads each list at startup and again every 6 hours, and keeps them in memory, so this part needs no database. When you open a channel, the server checks which of its streams are live right now and which a browser can play, using the same checks as the match streams. Streams that need a special referrer or user agent, or that are plain `http://` on an HTTPS site, are shown as links for VLC or mpv instead. Labels such as "Geo-blocked", "Not 24/7" and "SD" come from the lists themselves.

To add another collection, write a mapper in `server/src/services/iptvSources.js` that returns `makeIndex(...)`, and register its loader in `iptv.js`. The pages pick it up on their own.

## API

| Endpoint | Description |
|---|---|
| `GET /api/matches?day=today\|yesterday\|tomorrow\|all&status=live\|upcoming\|finished&q=` | Match list. Re-scrapes the source if the data is older than 60s. |
| `GET /api/matches/:id` | One match. |
| `GET /api/matches/:id/streams[?refresh=1]` | Stream servers for a match, resolved on demand and cached for 2 minutes. |
| `GET /api/iptv/sources` | The TV collections with their sizes and a small preview. |
| `GET /api/iptv/:source/filters` | Countries and categories (with channel counts) of one collection. Empty lists mean the collection has none. |
| `GET /api/iptv/:source/channels?country=&category=&q=&page=1&limit=48` | Channels, alphabetical, paginated (max 100 per page). `:source` is `world`, `more` or `free-tv`. |
| `GET /api/iptv/:source/channels/:id` | One channel. |
| `GET /api/iptv/:source/channels/:id/streams[?refresh=1]` | Live stream servers for a channel, checked on demand and cached for 2 minutes. |

## Layout

```
server/src/
  services/listing.js   parses a day's match list (pure, tested)
  services/streams.js   finds the real stream URLs behind a match
  services/matches.js   scrape + MongoDB upsert + caching
  services/http.js      fetch with SSRF protection and manifest probing
  services/iptvIndex.js generic TV catalogue: index, search, stream picking (pure, tested)
  services/iptvSources.js one mapper per collection: world, more, free-tv (pure, tested)
  services/iptv.js      downloads each collection, checks a channel's streams
  routes/ models/ app.js index.js
server/test/            fixtures taken from the real pages + node:test suites
client/src/
  pages/Home.jsx        day tabs, status chips, search, grouped by league
  pages/Watch.jsx       server picker, auto-fallback, stream link
  pages/TvHub.jsx       the three TV collections, side by side
  pages/Channels.jsx    browse one collection: search, filters, pages
  pages/ChannelWatch.jsx  plays a TV channel, same server picker
  components/           HlsPlayer, MatchCard, StreamLink
```

## Good to know

- **Streams belong to channels, not matches.** The source maps each match to a channel (for example beIN 1). A server can occasionally show a different match than the one you opened, and finished matches show whatever the channel is airing now. That comes from the source.
- **Logos burned into the video** (broadcaster or re-streamer watermarks) are part of the stream and can't be removed.
- **If the source changes its HTML**, `listing.test.js` and `streams.test.js` are where to look first. The parsers are small and isolated on purpose.
- Kick-off times are published in Egypt time and shown in your local time.
- The streams are third-party re-broadcasts of content owned by others. This app doesn't host or store any video; make sure using them is permitted where you live.
