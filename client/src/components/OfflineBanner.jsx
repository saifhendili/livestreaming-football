import { useEffect, useState } from 'react';

/** Matches and channels need a connection; say so instead of leaving the lists to fail one by one. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => window.navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  return (
    <p className="offline-banner" role="status">
      You&apos;re offline. Matches and channels need a connection.
    </p>
  );
}
