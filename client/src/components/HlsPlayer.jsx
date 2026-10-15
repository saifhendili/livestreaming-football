import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

const MAX_RECOVERIES = 2;
const STARTUP_TIMEOUT_MS = 20_000;

/**
 * Plays an HLS stream in our own <video>. Only the stream itself is loaded:
 * none of the source site's scripts (or their ads) ever run here.
 */
export default function HlsPlayer({ url, onFatal }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const onFatalRef = useRef(onFatal);
  onFatalRef.current = onFatal;

  const [status, setStatus] = useState('loading'); // loading | playing | error
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1); // -1 = auto

  useEffect(() => {
    const video = videoRef.current;
    let hls = null;
    let recoveries = 0;
    setStatus('loading');
    setLevels([]);
    setLevel(-1);

    let playing = false;
    const fail = () => {
      clearTimeout(watchdog);
      setStatus('error');
      onFatalRef.current?.();
    };
    const play = () =>
      video.play().catch(() => {
        // Autoplay with sound can be blocked; muted autoplay is allowed.
        video.muted = true;
        video.play().catch(() => {});
      });
    const onPlaying = () => {
      playing = true;
      clearTimeout(watchdog);
      setStatus('playing');
    };
    video.addEventListener('playing', onPlaying);
    // Whatever goes wrong, never spin forever: give up so the next server can be tried.
    const watchdog = setTimeout(() => {
      if (!playing) {
        hls?.destroy();
        hls = null;
        hlsRef.current = null;
        fail();
      }
    }, STARTUP_TIMEOUT_MS);

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels(
          data.levels.map((l, index) => ({ index, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps` })),
        );
        play();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // hls.js already retried manifest/level requests; startLoad() would not re-request them.
        const loadingPlaylist = /^(manifest|level)/i.test(data.details);
        const canRecover =
          recoveries < MAX_RECOVERIES &&
          ((data.type === Hls.ErrorTypes.NETWORK_ERROR && !loadingPlaylist) || data.type === Hls.ErrorTypes.MEDIA_ERROR);
        if (canRecover) {
          recoveries += 1;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else hls.recoverMediaError();
          return;
        }
        hls.destroy();
        hls = null;
        hlsRef.current = null;
        fail();
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively.
      video.src = url;
      video.addEventListener('loadedmetadata', play, { once: true });
      video.addEventListener('error', fail, { once: true });
    } else {
      fail();
    }

    return () => {
      clearTimeout(watchdog);
      video.removeEventListener('playing', onPlaying);
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  const chooseLevel = (value) => {
    const next = Number(value);
    setLevel(next);
    if (hlsRef.current) hlsRef.current.currentLevel = next;
  };

  return (
    <div className="player">
      <video ref={videoRef} className="video" controls playsInline />
      {status === 'loading' && (
        <div className="player-overlay">
          <span className="spinner" aria-hidden="true" /> Connecting to stream…
        </div>
      )}
      {status === 'error' && (
        <div className="player-overlay player-overlay-error">
          This stream could not be played. It may be offline or blocked from browsers.
        </div>
      )}
      {levels.length > 1 && (
        <label className="quality">
          Quality
          <select value={level} onChange={(e) => chooseLevel(e.target.value)}>
            <option value={-1}>Auto</option>
            {[...levels].reverse().map((l) => (
              <option key={l.index} value={l.index}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
