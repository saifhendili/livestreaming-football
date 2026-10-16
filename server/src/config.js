import 'dotenv/config';

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 5050),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27020/livestreaming',
  sourceUrl: (process.env.SOURCE_URL || 'https://fast-shot.com').replace(/\/+$/, ''),
  // Comma-separated site origins allowed to call the API from a browser. Empty allows any origin.
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  // The source publishes kick-off times in Egyptian time.
  sourceTimezone: 'Africa/Cairo',
  // How long a scraped day listing is considered fresh.
  listingTtlMs: num(process.env.LISTING_TTL_SECONDS, 60) * 1000,
  // How long resolved stream links are reused. Empty results are retried sooner.
  streamTtlMs: num(process.env.STREAM_TTL_SECONDS, 120) * 1000,
  emptyStreamTtlMs: num(process.env.EMPTY_STREAM_TTL_SECONDS, 20) * 1000,
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 8000),
  // Open channel and stream catalogue behind the TV channels section (https://github.com/iptv-org/api).
  iptvApiUrl: (process.env.IPTV_API_URL || 'https://iptv-org.github.io/api').replace(/\/+$/, ''),
  // The Free-TV playlist (https://github.com/Free-TV/IPTV), another source in the TV channels section.
  freeTvUrl: process.env.FREETV_URL || 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
  // How long a downloaded catalogue is reused before it is fetched again.
  iptvTtlMs: num(process.env.IPTV_TTL_HOURS, 6) * 60 * 60 * 1000,
  dramaFgCode: process.env.DRAMA_FG_CODE || '202122',
  dramaLiveUrl: (process.env.DRAMA_LIVE_URL || 'http://live.chiefapisource.pro/api/live/livedrama/v13.0.0').replace(/\/+$/, ''),
  dramaRedirectUrl: (process.env.DRAMA_REDIRECT_URL || 'http://redirect.chiefapisource.pro/redirect').replace(/\/+$/, ''),
  // Set the same 64-hex-character secret on every API instance to share playback URLs.
  dramaProxySecret: process.env.DRAMA_PROXY_SECRET || '',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};
