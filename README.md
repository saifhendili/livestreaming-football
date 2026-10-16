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

## Install it on your phone

Kickoff Live is a progressive web app, so it can be installed and opened full screen from the home screen. Open the deployed site over **HTTPS**:

- **Android (Chrome, Edge):** tap **Install** in the banner at the top of the page, or use the browser menu → *Install app*.
- **iPhone / iPad (Safari):** tap **Share** → *Add to Home Screen*.

The banner goes away once the app is installed, and stays away for two weeks if you dismiss it. A local `http://192.168…` address can't be installed: browsers only allow it on HTTPS (or `localhost`).

The service worker (`client/public/sw.js`) caches only the app itself, so it opens instantly and shows an "offline" notice without a connection. It never caches live data: the API, match lists, channel lists and video all come from the network. The build fills in the file list and a version for each deploy (`serviceWorker()` in `client/vite.config.js`); installing a new deploy replaces the old cache by itself. The icons are generated from `client/public/icons/icon.svg`.

## TV channels

The **TV channels** tab (`/tv`) has four collections. Each is its own list with its own data, filters and page (`/tv/drama`, `/tv/world`, `/tv/more`, `/tv/free-tv`), so the same channel can appear in more than one.

| Collection | Where it comes from | What it has |
|---|---|---|
| **Drama Live** (`drama`) | Drama Live's encrypted channel API | All TV categories from the provider, displayed as category tiles with their original names, order and artwork. Open a tile to browse channels, or choose All channels. |
| **Worldwide** (`world`) | The channel entries of the open [iptv-org](https://github.com/iptv-org/iptv) catalogue | About 10,000 channels with logos, filtered by country and category. Closed and adult channels are left out. |
| **More channels** (`more`) | iptv-org streams that belong to no channel entry | About 1,500 titles, mostly free streaming-service channels. Search only: they have no country, category or logo. Streams of the same title are merged. |
| **Free-TV** (`free-tv`) | The [Free-TV/IPTV](https://github.com/Free-TV/IPTV) playlist | About 1,800 hand-picked free channels, filtered by country or topic. Video-on-demand groups are left out. Its YouTube and Twitch entries open on their own site. |

The server downloads each list at startup and again every 6 hours, and keeps them in memory, so this part needs no database. For Worldwide, More channels and Free-TV, opening a channel checks its streams using the same checks as the match streams. Streams that need a special referrer or user agent, or that are plain `http://` on an HTTPS site, are shown as links for VLC or mpv instead. Labels such as "Geo-blocked", "Not 24/7" and "SD" come from the lists themselves.

Drama Live uses the recovered AES-128-CBC API envelope (`base64(ciphertext):base64(IV)`) on the server. The built-in FG code is `202122`; override it with `DRAMA_FG_CODE` in `server/.env`. No Python helper or imported static playlist is needed.

Opening the collection fetches the category list from `getliveTopics` and preserves its order. Each tile loads only its category when opened; `All channels` loads every category with at most four concurrent requests, deduplicates channels and supports global search and pagination. The category names are discovered dynamically, with no sports-only allowlist. Category lists and channel lists are cached for six hours and concurrent downloads are shared. Empty categories are valid; temporarily failed categories are disclosed in the all-channel results and retried after 30 seconds. Channel deep links load only that channel. Category and channel artwork is relayed through the API with raster-format validation, avoiding mixed-content failures on HTTPS pages. Category counts remain unknown until loaded, rather than displaying a false zero.

When a channel is opened, the API resolves its primary/backup options, including ordinary and JSON double redirects. The HLS adapter forwards the required headers and rewrites variants, segments, keys and maps, applying the app's segment URL substitutions such as removing `k9x_`. Failed playback still uses the existing player fallback and Refresh links controls. Browser-only and DRM recipes are skipped; upstream failures and regional restrictions can still prevent playback.

The media route only accepts encrypted, expiring playback tokens issued by the API; it never accepts an arbitrary URL query parameter. All media and redirect requests use the existing public-address checks. TLS certificate verification stays enabled. Media responses stream through Express without being stored, and the service worker does not cache them. This adds bandwidth usage to the API host. Deploy the Express API on a host that supports streaming responses; the static Vercel client alone cannot serve this feature. With a separately hosted API, set the existing `VITE_API_URL` and `CORS_ORIGIN` values as usual.

For production, set `DRAMA_PROXY_SECRET` to the same private 64-character hex value on every API instance (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Without it, a random per-process key is used for local development and old playback links stop working when the API restarts. Links expire after six hours; Refresh links issues new ones. `DRAMA_LIVE_URL` and `DRAMA_REDIRECT_URL` optionally override the upstream endpoints. The browser receives only API playback URLs, not upstream request headers or the AES API configuration.

To add another collection, write a mapper in `server/src/services/iptvSources.js` that returns `makeIndex(...)`, and register its loader in `iptv.js`. The pages pick it up on their own.

## API

| Endpoint | Description |
|---|---|
| `GET /api/matches?day=today\|yesterday\|tomorrow\|all&status=live\|upcoming\|finished&q=` | Match list. Re-scrapes the source if the data is older than 60s. |
| `GET /api/matches/:id` | One match. |
| `GET /api/matches/:id/streams[?refresh=1]` | Stream servers for a match, resolved on demand and cached for 2 minutes. |
| `GET /api/iptv/sources` | The TV collections with their sizes and a small preview. |
| `GET /api/iptv/:source/filters` | Countries and categories of one collection. Drama categories preserve source order and include artwork; counts are null until loaded. |
| `GET /api/iptv/:source/channels?country=&category=&q=&page=1&limit=48` | Channels, alphabetical, paginated (max 100 per page). `:source` is `drama`, `world`, `more` or `free-tv`. |
| `GET /api/iptv/:source/channels/:id` | One channel. |
| `GET /api/iptv/:source/channels/:id/streams[?refresh=1]` | Live stream servers for a channel, checked on demand and cached for 2 minutes. |
| `GET /api/iptv/drama/media/:resource?token=...` | Relay an issued HLS resource or raster artwork through the API. Stable resource paths preserve playback across live playlist refreshes; authorization remains encrypted and expiring. Preserves media byte ranges; expired/invalid tokens return 410. Older token-in-path links are also accepted. |

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
  services/drama.js     AES protocol, dynamic category API and stream recipes
  services/dramaCatalog.js category caching, all-channel loading and partial-result handling
  services/dramaPlayback.js encrypted playback tokens and HLS media adapter
  routes/ models/ app.js index.js
server/test/            fixtures taken from the real pages + node:test suites
client/src/
  pages/Home.jsx        day tabs, status chips, search, grouped by league
  pages/Watch.jsx       server picker, auto-fallback, stream link
  pages/TvHub.jsx       the four TV collections, side by side
  pages/Channels.jsx    browse one collection: search, filters, pages
  pages/DramaChannels.jsx category tiles, per-category lists and all-channel search
  pages/ChannelWatch.jsx  plays a TV channel, same server picker
  components/           HlsPlayer, MatchCard, StreamLink
```

## Good to know

- **Streams belong to channels, not matches.** The source maps each match to a channel (for example beIN 1). A server can occasionally show a different match than the one you opened, and finished matches show whatever the channel is airing now. That comes from the source.
- **Logos burned into the video** (broadcaster or re-streamer watermarks) are part of the stream and can't be removed.
- **If the source changes its HTML**, `listing.test.js` and `streams.test.js` are where to look first. The parsers are small and isolated on purpose.
- Kick-off times are published in Egypt time and shown in your local time.
- The streams are third-party re-broadcasts of content owned by others. Drama Live relays video through the API without storing it; make sure using them is permitted where you live.
