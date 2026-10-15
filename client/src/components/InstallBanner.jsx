import { useEffect, useState } from 'react';

const DISMISS_KEY = 'kickoff-install-dismissed';
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPads report themselves as Macs, hence the touch check.
const isIos = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
  (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode: the banner simply comes back next visit.
  }
}

/**
 * Offers to install the app. Chrome, Edge and Android hand us an install prompt to trigger;
 * iPhones and iPads have no such prompt, so we explain the Share-menu steps instead.
 */
export default function InstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault(); // keep the browser's own mini-bar from showing as well
      setPrompt(event);
    };
    const onInstalled = () => {
      setPrompt(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const ios = isIos();
  if (hidden || (!prompt && !ios)) return null;

  const dismiss = () => {
    rememberDismissed();
    setHidden(true);
  };
  const install = async () => {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null); // a prompt can only be used once
    if (outcome === 'dismissed') rememberDismissed();
  };

  return (
    <section className="install-banner" aria-label="Install the app">
      <img className="install-icon" src="/icons/icon-192.png" alt="" width="40" height="40" />
      <p className="install-text">
        <strong>Install Kickoff Live</strong>
        <span className="muted">
          {prompt ? 'Launch it from your home screen.' : 'Tap the Share button, then “Add to Home Screen”.'}
        </span>
      </p>
      {prompt && (
        <button className="btn btn-small" onClick={install}>
          Install
        </button>
      )}
      <button className="install-close" onClick={dismiss} aria-label="Not now">
        ×
      </button>
    </section>
  );
}
