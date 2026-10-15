import { useState } from 'react';

/** Shows the resolved stream link with a copy button (handy for VLC, mpv, IINA…). */
export default function StreamLink({ server }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(server.url);
    } catch {
      // Clipboard API needs a secure context; fall back to selecting the text.
      const input = document.getElementById('stream-url');
      input.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const label = server.type === 'embed' ? 'Player page' : `Stream link (${server.type.toUpperCase()})`;

  return (
    <div className="linkbox">
      <label htmlFor="stream-url">{label}</label>
      <div className="linkrow">
        <input id="stream-url" readOnly value={server.url} dir="ltr" onFocus={(e) => e.target.select()} />
        <button className="btn" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <a className="btn btn-ghost" href={server.url} target="_blank" rel="noreferrer noopener">
          Open
        </a>
      </div>
      {server.type === 'hls' && <p className="hint">Paste this into VLC (Media → Open Network Stream) or mpv to watch outside the browser.</p>}
    </div>
  );
}
