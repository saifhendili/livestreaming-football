# IPTV Stream Servers

Servers extracted from the unpacked APK in this project.

| Field | Value |
|-------|-------|
| App | Drama Live |
| Package | `com.sneig.livedrama` |
| Version | 13.0.3 |
| Type | IPTV / media player (M3U, Xtream, FG code) |

## Primary stream server

The server that serves the live channel and stream data:

```
http://live.chiefapisource.pro/api/live/livedrama/v13.0.0/
```

This is the `live_url` entry in the app's default server settings.

## Main API servers

| Role | URL |
|------|-----|
| Main (`server_url`) | `http://main.chiefapisource.pro/api/live/livedrama/v13.0.0/` |
| Live (`live_url`) | `http://live.chiefapisource.pro/api/live/livedrama/v13.0.0/` |

### Fallback main servers

Tried when the main server is unreachable (`mainServerModelArraylist`):

1. `http://main.backendcoreapi.com/api/live/livedrama/v13.0.0/`
2. `http://main.semprotech.online/api/live/livedrama/v13.0.0/`
3. `http://main.swiftapi.org/api/live/livedrama/v13.0.0/`
4. `http://18.194.81.219:8787/api/live/livedrama/v13.0.0/`
5. `http://dramalive.app:8787/api/live/livedrama/v13.0.0/`

## Other backend services

| Role | URL / host |
|------|------------|
| Sports server (`sport_server_url`) | `http://sport.chiefapisource.pro/sport/` |
| File server (`file_server_url`) | `http://file.chiefapisource.pro/` |
| Smart search (`smart_search_url`) | `http://shows.chiefapisource.pro/search/v3/` |
| Redirect (`redirect_url`) | `http://redirect.chiefapisource.pro/redirect/` |
| Chat API (`chat_http_url`) | `http://chat.chiefapisource.pro/chat/api/` |
| XMPP chat host (`xmpp_ip`) | `fire.chiefapisource.pro` |
| Log (`log_url`) | `http://log.chiefapisource.pro/api/live/livedrama/v9.0.0/` |
| FG code service (`fgcode_url`) | `fgcode.org` (the UI help text links to `https://fgcode.store/`) |
| Firebase Realtime DB | `https://live-2345a.firebaseio.com` |

## Xtream proxy

When a user enters their own Xtream Codes login, the app routes the request through a third-party PHP proxy:

```
http://mikkm.xyz/android/androidApi.php?url=http://<user-xtream-host>/&mode=live&username=<user>&password=<pass>
```

The Xtream host, username and password are entered by the user. They are not hardcoded in the app.

## Where this was found

- `classes.dex`, class `Lo8/n;`, method `j(Context)`. It reads saved settings from SharedPreferences and falls back to an embedded default JSON (`serverSettingsModel`, `mainServerModelArraylist`).
- `classes.dex`, class `Lcom/sneig/livedrama/fragments/b;`, method `E()`. It builds the Xtream proxy URL.
- `resources.arsc`. It holds the Firebase project ID and URL and the FG-code help text.

## Notes

- All of these servers use plain `http://`, apart from the Firebase and fgcode.store links.
- The app says it supplies no content. Users bring their own M3U, Xtream or FG-code playlists.
- The embedded config is only the default. The app can replace it with settings fetched at runtime, so the live endpoints may differ from these values.
- The embedded config also contains hardcoded crash-reporting credentials. They are deliberately left out of this file.
