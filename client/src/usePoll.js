import { useEffect, useState } from 'react';

/**
 * Run `load(signal)` now and then again every `interval` ms.
 * `interval` may be a function of the latest data (return 0 to stop polling).
 * State resets whenever `deps` change; a failed refresh keeps the last good data.
 */
export function usePoll(load, deps, interval = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    let timer;
    const controller = new AbortController();
    setState({ data: null, error: null, loading: true });

    const run = async () => {
      let next;
      try {
        const data = await load(controller.signal);
        if (!alive) return;
        setState({ data, error: null, loading: false });
        next = typeof interval === 'function' ? interval(data) : interval;
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        setState((s) => ({ ...s, error: err.message, loading: false }));
        next = typeof interval === 'function' ? interval(null) : interval;
      }
      if (next) timer = setTimeout(run, next);
    };
    run();

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
